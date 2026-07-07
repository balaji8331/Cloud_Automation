/**
 * POST /api/jobs/run-now
 * Immediately triggers a deletion schedule run (dry or live depending on approval state).
 * Replaces the broken JobQueue implementation — executes directly via executeScheduleRun.
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import { executeScheduleRun } from "@/jobs/deletionExecutor";

export async function POST(req: Request) {
  try {
    await requireRole("ADMIN");

    const body = await req.json();
    const { referenceId } = body as { jobType?: string; tenantId?: string; referenceId?: string };

    if (!referenceId) {
      return NextResponse.json({ error: "referenceId (scheduleId) is required" }, { status: 400 });
    }

    // Fire async — don't await (run can take minutes due to notifyBeforeMinutes wait)
    executeScheduleRun(referenceId).catch((e) =>
      console.error(`[RunNow] Schedule ${referenceId} failed:`, e)
    );

    return NextResponse.json({ jobId: referenceId, status: "queued", message: "Run started. Check run history for progress." });
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[RunNow] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
