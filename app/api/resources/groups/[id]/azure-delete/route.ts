/**
 * POST /api/resources/groups/:id/azure-delete
 *
 * Deletes a REAL Azure resource group (and all its resources).
 * Extremely destructive — irreversible.
 *
 * Body: { confirmName: string }  — must match resourceGroup.name exactly
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { getTenantCredentials } from "@/lib/db/tenants";
import { deleteAzureResourceGroup } from "@/lib/azure/deleteResource";
import { writeAuditLog } from "@/lib/db/audit";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");

    const body = await req.json().catch(() => ({}));
    const { confirmName } = body as { confirmName?: string };

    // Load resource group from DB
    const rg = await prisma.resourceGroup.findUnique({
      where: { id: params.id },
      include: {
        tenant: true,
        subscription: true,
        resources: { where: { isActive: true }, select: { name: true, type: true, resourceId: true } },
      },
    });

    if (!rg) {
      return NextResponse.json({ error: "Resource group not found" }, { status: 404 });
    }

    // Confirmation check
    if (!confirmName || confirmName.trim() !== rg.name) {
      return NextResponse.json(
        { error: `Confirmation name does not match. Expected: "${rg.name}"` },
        { status: 400 }
      );
    }

    const creds = await getTenantCredentials(rg.tenantId);
    if (!creds) {
      return NextResponse.json({ error: "Could not load tenant credentials" }, { status: 500 });
    }

    // Save full snapshot to audit log BEFORE deletion
    await writeAuditLog({
      userId: session.user.id,
      action: "AZURE_DELETE_RESOURCE_GROUP",
      resourceType: "azure_resource_group_delete",
      resourceId: rg.id,
      metadata: {
        action: "azure_delete_resource_group",
        confirmedBy: session.user.email,
        resourceGroupSnapshot: {
          id: rg.id,
          name: rg.name,
          location: rg.location,
          subscriptionId: rg.subscription.subscriptionId,
          tenantName: rg.tenant.name,
          resourceCount: rg.resources.length,
          resources: rg.resources.slice(0, 50), // cap snapshot size
          tags: rg.tags,
        },
      },
    });

    console.log(
      `[AzureDelete] RESOURCE GROUP — user=${session.user.email} rg="${rg.name}" sub=${rg.subscription.subscriptionId} resources=${rg.resources.length}`
    );

    // Call Azure ARM DELETE
    const result = await deleteAzureResourceGroup(
      {
        azureTenantId: creds.azureTenantId,
        clientId: creds.clientId,
        clientSecret: creds.clientSecret,
      },
      rg.subscription.subscriptionId,
      rg.name
    );

    if (!result.success) {
      console.error(`[AzureDelete] RG FAILED: ${result.error}`);
      return NextResponse.json(
        { error: `Azure delete failed: ${result.error}` },
        { status: 400 }
      );
    }

    // Mark RG and all its resources as inactive in DB
    await prisma.$transaction([
      prisma.resource.updateMany({
        where: { resourceGroupId: params.id },
        data: { isActive: false, manuallyRemoved: true },
      }),
      prisma.resourceGroup.update({
        where: { id: params.id },
        data: { isActive: false },
      }),
    ]);

    console.log(`[AzureDelete] RG SUCCESS — "${rg.name}" deleted (async=${result.async})`);

    return NextResponse.json({
      success: true,
      async: result.async,
      statusUrl: result.statusUrl,
      resourceCount: rg.resources.length,
      message: result.async
        ? `Delete accepted by Azure — "${rg.name}" is being deleted asynchronously`
        : `Resource group "${rg.name}" deleted successfully`,
    });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[POST /api/resources/groups/:id/azure-delete]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
