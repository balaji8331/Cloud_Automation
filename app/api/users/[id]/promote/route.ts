/**
 * POST /api/users/:id/promote
 * Promotes a user to SUPER_ADMIN role.
 * Only callable by existing SUPER_ADMIN users — admins cannot grant this role.
 * Logs to audit_log with PROMOTE_TO_SUPER_ADMIN action.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

export async function POST(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole(["SUPER_ADMIN"]);

    if (params.id === session.user.id) {
      return NextResponse.json(
        { error: "You are already a SUPER_ADMIN" },
        { status: 400 }
      );
    }

    const target = await prisma.user.findUnique({
      where: { id: params.id },
      select: { id: true, email: true, role: true, name: true },
    });

    if (!target) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    if (target.role === "SUPER_ADMIN") {
      return NextResponse.json(
        { error: "User is already a SUPER_ADMIN" },
        { status: 400 }
      );
    }

    const updated = await prisma.user.update({
      where: { id: params.id },
      data: { role: "SUPER_ADMIN" },
      select: { id: true, email: true, name: true, role: true },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "PROMOTE_TO_SUPER_ADMIN",
      resourceType: "user",
      resourceId: params.id,
      metadata: {
        targetEmail: target.email,
        previousRole: target.role,
        newRole: "SUPER_ADMIN",
      },
    });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json(
        { error: err.message },
        { status: (err as { status: number }).status }
      );
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
