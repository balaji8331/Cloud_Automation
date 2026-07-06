/**
 * PATCH  /api/users/:id  — update user role / name
 * DELETE /api/users/:id  — delete user
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

const UpdateUserSchema = z.object({
  name: z.string().optional(),
  role: z.enum(["ADMIN", "FINANCE", "READONLY"]).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = UpdateUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const user = await prisma.user.update({
      where: { id: params.id },
      data: parsed.data,
      select: { id: true, email: true, name: true, role: true },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE_USER",
      resourceType: "user",
      resourceId: params.id,
    });

    return NextResponse.json(user);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");

    // Prevent self-deletion
    if (params.id === session.user.id) {
      return NextResponse.json({ error: "Cannot delete your own account" }, { status: 400 });
    }

    await prisma.user.delete({ where: { id: params.id } });

    await writeAuditLog({
      userId: session.user.id,
      action: "DELETE_USER",
      resourceType: "user",
      resourceId: params.id,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
