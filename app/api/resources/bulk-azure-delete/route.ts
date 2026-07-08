/**
 * POST /api/resources/bulk-azure-delete
 *
 * Deletes multiple resources or resource groups directly from Azure.
 *
 * Body: {
 *   ids: string[],
 *   targetType: "resource" | "resource_group",
 *   confirmPhrase: string
 * }
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { getTenantCredentials } from "@/lib/db/tenants";
import { getProviderClient } from "@/lib/providers";
import { writeAuditLog } from "@/lib/db/audit";

function isNestedResourceError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("nested resource") ||
    lower.includes("child resource") ||
    (lower.includes("cannot delete") && lower.includes("exist"))
  );
}

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json().catch(() => ({}));
    const { ids, targetType, confirmPhrase } = body as {
      ids?: string[];
      targetType?: "resource" | "resource_group";
      confirmPhrase?: string;
    };

    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "No ids provided" }, { status: 400 });
    }
    if (targetType !== "resource" && targetType !== "resource_group") {
      return NextResponse.json({ error: "Invalid targetType" }, { status: 400 });
    }
    if (confirmPhrase !== "DELETE MULTIPLE") {
      return NextResponse.json({ error: "Invalid confirmation phrase" }, { status: 400 });
    }

    const results: any[] = [];
    let successfulDeletes = 0;

    for (const id of ids) {
      try {
        if (targetType === "resource") {
          // Load resource from DB
          const resource = await prisma.resource.findUnique({
            where: { id },
            include: {
              tenant: true,
              subscription: true,
              resourceGroup: { select: { name: true } },
            },
          });

          if (!resource) {
            results.push({ id, error: "Not found in DB" });
            continue;
          }

          // Pre-flight check
          const potentialChildren = await prisma.resource.findMany({
            where: {
              tenantId: resource.tenantId,
              isActive: true,
              id: { not: id },
            },
            select: { id: true, name: true, type: true, resourceId: true },
          });

          const childPrefix = resource.resourceId.toLowerCase() + "/";
          const children = potentialChildren.filter((r) =>
            r.resourceId.toLowerCase().startsWith(childPrefix)
          );

          if (children.length > 0) {
            results.push({ id, name: resource.name, error: "Nested children exist" });
            continue;
          }

          const creds = await getTenantCredentials(resource.tenantId);
          if (!creds) {
            results.push({ id, name: resource.name, error: "Credentials missing" });
            continue;
          }

          await writeAuditLog({
            userId: session.user.id,
            action: "AZURE_DELETE_RESOURCE",
            resourceType: "azure_resource_delete",
            resourceId: resource.id,
            metadata: {
              action: "bulk_azure_delete",
              confirmedBy: session.user.email,
              resourceSnapshot: {
                name: resource.name,
                type: resource.type,
                resourceId: resource.resourceId,
              },
            },
          });

          const providerClient = getProviderClient({
            provider: creds.provider,
            credentialData: creds.credentialData
          });

          try {
            await providerClient.deleteResource(resource.resourceId);

            await prisma.resource.update({
              where: { id },
              data: { isActive: false, manuallyRemoved: true },
            });

            results.push({ id, name: resource.name, success: true });
            successfulDeletes++;
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            if (isNestedResourceError(errorMsg)) {
              results.push({ id, name: resource.name, error: "Azure reports nested resources exist" });
            } else {
              results.push({ id, name: resource.name, error: errorMsg });
            }
          }

        } else {
          // targetType === "resource_group"
          const group = await prisma.resourceGroup.findUnique({
            where: { id },
            include: { tenant: true, subscription: true },
          });

          if (!group) {
            results.push({ id, error: "Not found in DB" });
            continue;
          }

          const creds = await getTenantCredentials(group.tenantId);
          if (!creds) {
            results.push({ id, name: group.name, error: "Credentials missing" });
            continue;
          }

          const armGroupId = `/subscriptions/${group.subscription.subscriptionId}/resourceGroups/${group.name}`;

          await writeAuditLog({
            userId: session.user.id,
            action: "AZURE_DELETE_RESOURCE_GROUP",
            resourceType: "azure_rg_delete",
            resourceId: group.id,
            metadata: {
              action: "bulk_azure_delete",
              confirmedBy: session.user.email,
              groupSnapshot: {
                name: group.name,
                subscriptionId: group.subscription.subscriptionId,
              },
            },
          });

          const providerClient = getProviderClient({
            provider: creds.provider,
            credentialData: creds.credentialData
          });

          try {
            await providerClient.deleteResource(armGroupId);

            await prisma.resourceGroup.update({
              where: { id },
              data: { isActive: false },
            });

            // Cascade manuallyRemoved to all resources in this group
            await prisma.resource.updateMany({
              where: { resourceGroupId: id },
              data: { isActive: false, manuallyRemoved: true },
            });

            results.push({ id, name: group.name, success: true });
            successfulDeletes++;
          } catch (err: unknown) {
            const errorMsg = err instanceof Error ? err.message : String(err);
            results.push({ id, name: group.name, error: errorMsg });
          }
        }
      } catch (err: any) {
        results.push({ id, error: err.message || "Unknown error" });
      }
    }

    if (successfulDeletes === 0) {
      return NextResponse.json({
        success: false,
        error: "All deletion requests failed.",
        results
      }, { status: 400 });
    }

    return NextResponse.json({
      success: true,
      deleted: successfulDeletes,
      total: ids.length,
      results
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[POST /api/resources/bulk-azure-delete]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
