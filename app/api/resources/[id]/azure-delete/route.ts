/**
 * POST /api/resources/:id/azure-delete
 *
 * Deletes a REAL Azure resource. High-risk operation.
 * - Admin only
 * - Requires confirmation name match in request body
 * - Pre-flight check: rejects with 409 if the resource has live children in DB
 * - Saves full resource snapshot to audit_log before deletion
 * - Marks DB record inactive after Azure confirms deletion
 *
 * Body: { confirmName: string }  — must match resource.name exactly
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { getTenantCredentials } from "@/lib/db/tenants";
import { deleteAzureResource } from "@/lib/azure/deleteResource";
import { writeAuditLog } from "@/lib/db/audit";

/** True if the ARM error message is a "nested resources exist" conflict */
function isNestedResourceError(msg: string): boolean {
  const lower = msg.toLowerCase();
  return (
    lower.includes("nested resource") ||
    lower.includes("child resource") ||
    (lower.includes("cannot delete") && lower.includes("exist"))
  );
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");

    const body = await req.json().catch(() => ({}));
    const { confirmName } = body as { confirmName?: string };

    // Load resource from DB
    const resource = await prisma.resource.findUnique({
      where: { id: params.id },
      include: {
        tenant: true,
        subscription: true,
        resourceGroup: { select: { name: true } },
      },
    });

    if (!resource) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }

    // Confirmation check — must type exact resource name
    if (!confirmName || confirmName.trim() !== resource.name) {
      return NextResponse.json(
        { error: `Confirmation name does not match. Expected: "${resource.name}"` },
        { status: 400 }
      );
    }

    // ── Pre-flight: detect child resources in our DB ──────────────────────
    // Azure will reject with "nested resources exist" if children are still live.
    // Check our DB first to give a clear, actionable error before even calling Azure.
    // Match children by resourceId prefix: any resource whose ARM ID starts with
    // this resource's ARM ID + "/" is a direct or indirect child.
    const potentialChildren = await prisma.resource.findMany({
      where: {
        tenantId: resource.tenantId,
        isActive: true,
        id: { not: params.id },
      },
      select: { id: true, name: true, type: true, resourceId: true },
    });

    const childPrefix = resource.resourceId.toLowerCase() + "/";
    const children = potentialChildren.filter((r) =>
      r.resourceId.toLowerCase().startsWith(childPrefix)
    );

    if (children.length > 0) {
      return NextResponse.json(
        {
          error: `Cannot delete "${resource.name}" while nested child resources still exist. Delete these first:`,
          nestedChildren: children.map((c) => ({
            id: c.id,
            name: c.name,
            type: c.type,
          })),
        },
        { status: 409 }
      );
    }

    // Load tenant credentials
    const creds = await getTenantCredentials(resource.tenantId);
    if (!creds) {
      return NextResponse.json({ error: "Could not load tenant credentials" }, { status: 500 });
    }

    // Save full resource snapshot to audit log BEFORE deletion
    await writeAuditLog({
      userId: session.user.id,
      action: "AZURE_DELETE_RESOURCE",
      resourceType: "azure_resource_delete",
      resourceId: resource.id,
      metadata: {
        action: "azure_delete",
        confirmedBy: session.user.email,
        resourceSnapshot: {
          id: resource.id,
          resourceId: resource.resourceId,
          name: resource.name,
          type: resource.type,
          location: resource.location,
          resourceGroup: resource.resourceGroup.name,
          subscriptionId: resource.subscription.subscriptionId,
          tenantName: resource.tenant.name,
          provisioningState: resource.provisioningState,
          tags: resource.tags,
          sku: resource.sku,
          lastSyncedAt: resource.lastSyncedAt,
        },
      },
    });

    console.log(
      `[AzureDelete] RESOURCE — user=${session.user.email} resource="${resource.name}" type=${resource.type} id=${resource.resourceId}`
    );

    // Call Azure ARM DELETE
    const result = await deleteAzureResource(
      {
        azureTenantId: creds.azureTenantId,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      },
      resource.resourceId,
      resource.type,
      resource.subscription.subscriptionId
    );

    if (result.usedPreviewApiVersion) {
      console.warn(
        `[AzureDelete] ⚠️ Used preview API version ${result.apiVersionUsed} for ${resource.type}`
      );
    }

    if (!result.success) {
      console.error(`[AzureDelete] FAILED: ${result.error}`);

      // Azure returned nested-resource error even though our DB check passed —
      // this means Azure has children our DB doesn't know about yet (not synced).
      if (result.error && isNestedResourceError(result.error)) {
        return NextResponse.json(
          {
            error: `Azure reports nested resources still exist for "${resource.name}". Run a resource sync then try again, or delete child resources directly in Azure Portal first.`,
            azureError: result.error,
          },
          { status: 409 }
        );
      }

      return NextResponse.json(
        { error: `Azure delete failed: ${result.error}` },
        { status: 400 }
      );
    }

    // Mark as inactive in our DB
    await prisma.resource.update({
      where: { id: params.id },
      data: { isActive: false, manuallyRemoved: true },
    });

    console.log(`[AzureDelete] SUCCESS — resource "${resource.name}" deleted (async=${result.async})`);

    return NextResponse.json({
      success: true,
      async: result.async,
      statusUrl: result.statusUrl,
      message: result.async
        ? "Delete accepted by Azure — resource is being deleted asynchronously"
        : "Resource deleted successfully",
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[POST /api/resources/:id/azure-delete]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
