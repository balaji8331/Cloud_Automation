/**
 * POST /api/resources/groups/:id/remove
 * Portal-only soft delete of a resource group.
 * Does NOT call Azure. Also marks all child resources as manuallyRemoved.
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");

    const rg = await prisma.resourceGroup.findUnique({
      where: { id: params.id },
      include: { tenant: { select: { name: true } } },
    });

    if (!rg) {
      return NextResponse.json({ error: "Resource group not found" }, { status: 404 });
    }

    // Soft-delete the group and all its resources
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

    await writeAuditLog({
      userId: session.user.id,
      action: "BULK_REMOVE_RESOURCE_GROUP",
      resourceType: "resource_group",
      resourceId: params.id,
      metadata: {
        action: "manual_remove",
        resourceGroupName: rg.name,
        tenantName: rg.tenant.name,
      },
    });

    console.log(`[ManualRemove] user=${session.user.email} removed resource group "${rg.name}"`);

    return NextResponse.json({ success: true, resourceGroupName: rg.name });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[POST /api/resources/groups/:id/remove]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
