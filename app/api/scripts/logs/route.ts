import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";

export async function GET(req: Request) {
  try {
    await requireRole("SUPER_ADMIN");

    const runs = await prisma.scriptRun.findMany({
      orderBy: { startedAt: "desc" },
      include: {
        tenant: { select: { name: true } },
        triggeredBy: { select: { email: true, name: true } }
      }
    });

    return NextResponse.json(runs);
  } catch (err: any) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[GetLogs] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
