/**
 * GET  /api/users  — list users (ADMIN only)
 * POST /api/users  — create user (ADMIN only)
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

const CreateUserSchema = z.object({
  email: z.string().email(),
  name: z.string().optional(),
  password: z.string().min(8),
  role: z.enum(["ADMIN", "FINANCE", "READONLY"]),
});

export async function GET() {
  try {
    const session = await requireRole("ADMIN");

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { createdAt: "asc" },
    });

    await writeAuditLog({ userId: session.user.id, action: "VIEW_USERS" });
    return NextResponse.json(users);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = CreateUserSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const existing = await prisma.user.findUnique({
      where: { email: parsed.data.email },
    });
    if (existing) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    const hash = await bcrypt.hash(parsed.data.password, 12);
    const user = await prisma.user.create({
      data: {
        email: parsed.data.email,
        name: parsed.data.name,
        password: hash,
        role: parsed.data.role,
      },
      select: { id: true, email: true, name: true, role: true, createdAt: true },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE_USER",
      resourceType: "user",
      resourceId: user.id,
    });

    return NextResponse.json(user, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
