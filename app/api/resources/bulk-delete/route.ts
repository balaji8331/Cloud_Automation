/**
 * POST /api/resources/bulk-delete
 * Bulk portal-only soft delete for resources or resource groups.
 * Body: { ids: string[], targetType: "resource" | "resource_group" }
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const { ids, targetType } = body as { ids: string[]; targetType: "resource" | "resource_group" };

    if (!ids?.length || !targetType) {
      return NextResponse.json({ error: "ids and targetType required" }, { status: 400 });
    }

    if (targetType === "resource_group") {
      // Soft-delete each RG and all its resources
      await prisma.$transaction([
        prisma.resource.updateMany({
          where: { resourceGroupId: { in: ids } },
          data: { isActive: false, manuallyRemoved: true },
        }),
        prisma.resourceGroup.updateMany({
          where: { id: { in: ids } },
          data: { isActive: false },
        }),
      ]);
    } else {
      await prisma.resource.updateMany({
        where: { id: { in: ids } },
        data: { isActive: false, manuallyRemoved: true },
      });
    }

    await writeAuditLog({
      userId: session.user.id,
      action: "BULK_REMOVE_RESOURCE",
      resourceType: `bulk_remove_${targetType}`,
      metadata: { ids, count: ids.length, action: "manual_remove" },
    });

    return NextResponse.json({ success: true, removed: ids.length });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
