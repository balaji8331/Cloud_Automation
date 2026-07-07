/**
 * PATCH  /api/automation/schedules/:id  — update schedule
 * DELETE /api/automation/schedules/:id  — delete schedule
 *
 * Editing scopeType or targetIds to DIFFERENT values resets approvalStatus
 * to PENDING_DRY_RUN, forcing a fresh dry run + approval cycle.
 * Editing cronExpression, name, notifyEmails, notifyBeforeMinutes, excludeTagKey
 * does NOT reset approval — those are safe changes.
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { ApprovalStatus } from "@prisma/client";

const UpdateSchema = z.object({
  tenantId: z.string().optional(),          // allowed but triggers scope reset if changed
  name: z.string().min(1).max(100).optional(),
  cronExpression: z.string().min(5).optional(),
  isEnabled: z.boolean().optional(),
  excludeTagKey: z.string().optional(),
  notifyBeforeMinutes: z.number().int().min(0).max(1440).optional(),
  notifyEmails: z.string().optional(),
  scopeType: z.enum(["RESOURCE_GROUP", "SUBSCRIPTION", "MULTIPLE_RESOURCE_GROUPS"]).optional(),
  targetIds: z.array(z.string()).min(1).optional(),
});

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    await requireRole("ADMIN");
    const body = await req.json();
    const parsed = UpdateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    // Load current schedule to compare scope/target changes
    const existing = await prisma.deletionSchedule.findUnique({ where: { id: params.id } });
    if (!existing) return NextResponse.json({ error: "Schedule not found" }, { status: 404 });

    const data: Record<string, unknown> = { ...parsed.data };

    // Disabling → DISABLED status
    if (parsed.data.isEnabled === false) {
      data.approvalStatus = ApprovalStatus.DISABLED;
    }

    // Re-enabling from DISABLED → start fresh dry run cycle
    if (parsed.data.isEnabled === true && existing.approvalStatus === ApprovalStatus.DISABLED) {
      data.approvalStatus = ApprovalStatus.PENDING_DRY_RUN;
      data.approveToken = null;
      data.approveTokenExpiresAt = null;
    }

    // Check if scopeType, targetIds, or tenantId actually changed — only reset if values differ
    const tenantChanged = parsed.data.tenantId !== undefined &&
      parsed.data.tenantId !== existing.tenantId;

    const scopeChanged = parsed.data.scopeType !== undefined &&
      parsed.data.scopeType !== existing.scopeType;

    const newTargets = parsed.data.targetIds;
    const existingTargets = existing.targetIds as string[];
    const targetsChanged = newTargets !== undefined && (
      newTargets.length !== existingTargets.length ||
      newTargets.some((t) => !existingTargets.includes(t)) ||
      existingTargets.some((t) => !newTargets.includes(t))
    );

    if (tenantChanged || scopeChanged || targetsChanged) {
      data.approvalStatus = ApprovalStatus.PENDING_DRY_RUN;
      data.approveToken = null;
      data.approveTokenExpiresAt = null;
      console.log(`[Automation] Schedule "${existing.name}" tenant/scope/targets changed — reset to PENDING_DRY_RUN`);
    }

    const schedule = await prisma.deletionSchedule.update({
      where: { id: params.id },
      data,
    });

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
    return NextResponse.json({ success: true });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
