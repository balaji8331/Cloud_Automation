/**
 * POST /api/automation/schedules/:id/run
 * Manual trigger — fires the schedule immediately (dry or live depending on approval state).
 * GET  /api/automation/schedules/:id/run  — list run history for this schedule
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { executeScheduleRun } from "@/jobs/deletionExecutor";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("ADMIN");
    const runs = await prisma.deletionRun.findMany({
      where: { scheduleId: params.id },
      orderBy: { startedAt: "desc" },
      take: 50,
    });
    return NextResponse.json(runs);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("ADMIN");

    // Fire async — don't await (could take minutes)
    executeScheduleRun(params.id).catch((e) =>
      console.error(`[ManualRun] Schedule ${params.id} failed:`, e)
    );

    return NextResponse.json({ message: "Run started. Check run history for progress." });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
