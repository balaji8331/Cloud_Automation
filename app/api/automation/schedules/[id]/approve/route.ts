/**
 * POST /api/automation/schedules/:id/approve
 * Admin explicitly approves live deletions for a schedule.
 * Only allowed after at least one dry-run has been completed.
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole("ADMIN");

    const schedule = await prisma.deletionSchedule.findUnique({ where: { id: params.id } });
    if (!schedule) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    // Require at least one completed dry-run before approving
    const dryRun = await prisma.deletionRun.findFirst({
      where: { scheduleId: params.id, status: "DRY_RUN" },
    });
    if (!dryRun) {
      return NextResponse.json(
        { error: "Cannot approve: schedule has not completed a dry run yet. Wait for the first scheduled run." },
        { status: 400 }
      );
    }

    await prisma.deletionSchedule.update({
      where: { id: params.id },
      data: { liveDeletesApproved: true },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "APPROVE_DELETION_SCHEDULE",
      resourceType: "deletion_schedule",
      resourceId: params.id,
      metadata: { action: "approve_live_deletes", scheduleName: schedule.name },
    });

    return NextResponse.json({ success: true, message: "Live deletions approved. Next scheduled run will delete real resources." });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
