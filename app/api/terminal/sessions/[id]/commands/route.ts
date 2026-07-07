/**
 * GET /api/terminal/sessions/:id/commands
 * Return full command history for a terminal session (SUPER_ADMIN only).
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    await requireRole(["SUPER_ADMIN"]);

    const commands = await prisma.terminalCommand.findMany({
      where: { sessionId: params.id },
      orderBy: { executedAt: "asc" },
    });

    return NextResponse.json(commands);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
