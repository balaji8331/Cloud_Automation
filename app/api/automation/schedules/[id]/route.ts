/**
 * PATCH  /api/automation/schedules/:id  — update (name, cron, enabled, etc.)
 * DELETE /api/automation/schedules/:id  — remove schedule
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { refreshDeletionSchedulers } from "@/jobs/deletionExecutor";

const UpdateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  cronExpression: z.string().min(5).optional(),
  isEnabled: z.boolean().optional(),
  excludeTagKey: z.string().optional(),
  notifyBeforeMinutes: z.number().int().min(0).max(1440).optional(),
  notifyEmails: z.string().optional(),
  targetIds: z.array(z.string()).min(1).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("ADMIN");
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // If disabling, revoke live-delete approval too for safety
    const data: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.isEnabled === false) data.liveDeletesApproved = false;

    const schedule = await prisma.deletionSchedule.update({
      where: { id: params.id },
      data,
    });

    await refreshDeletionSchedulers();
    return NextResponse.json(schedule);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("ADMIN");
    await prisma.deletionSchedule.delete({ where: { id: params.id } });
    await refreshDeletionSchedulers();
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
