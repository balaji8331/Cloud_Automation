/**
 * GET /api/terminal/sessions
 * List all terminal sessions (SUPER_ADMIN only).
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";

export async function GET() {
  try {
    await requireRole(["SUPER_ADMIN"]);

    const sessions = await prisma.terminalSession.findMany({
      orderBy: { startedAt: "desc" },
      include: {
        user: { select: { id: true, email: true, name: true } },
        tenant: { select: { id: true, name: true } },
        _count: { select: { commands: true } },
      },
    });

    return NextResponse.json(sessions);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
