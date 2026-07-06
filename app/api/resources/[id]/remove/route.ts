/**
 * POST /api/resources/:id/remove
 * Portal-only soft delete — sets manuallyRemoved=true, isActive=false.
 * Does NOT call Azure. Next sync will restore it if still active in Azure.
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

    const resource = await prisma.resource.findUnique({
      where: { id: params.id },
      include: { tenant: { select: { name: true } } },
    });

    if (!resource) {
      return NextResponse.json({ error: "Resource not found" }, { status: 404 });
    }

    await prisma.resource.update({
      where: { id: params.id },
      data: { isActive: false, manuallyRemoved: true },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "REMOVE_RESOURCE", // portal soft-delete
      resourceType: "resource",
      resourceId: params.id,
      metadata: {
        action: "manual_remove",
        resourceName: resource.name,
        resourceType: resource.type,
        tenantName: resource.tenant.name,
        resourceId: resource.resourceId,
      },
    });

    console.log(`[ManualRemove] user=${session.user.email} removed resource "${resource.name}" (${resource.resourceId})`);

    return NextResponse.json({ success: true, resourceName: resource.name });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[POST /api/resources/:id/remove]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
