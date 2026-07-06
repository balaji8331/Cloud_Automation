/**
 * GET  /api/automation/schedules   — list all schedules
 * POST /api/automation/schedules   — create a schedule
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { refreshDeletionSchedulers } from "@/jobs/deletionExecutor";

const CreateSchema = z.object({
  tenantId: z.string(),
  name: z.string().min(1).max(100),
  scopeType: z.enum(["RESOURCE_GROUP", "SUBSCRIPTION", "MULTIPLE_RESOURCE_GROUPS"]),
  targetIds: z.array(z.string()).min(1),
  cronExpression: z.string().min(5),
  excludeTagKey: z.string().default("donotdelete"),
  notifyBeforeMinutes: z.number().int().min(0).max(1440).default(60),
  notifyEmails: z.string().default(""),
});

export async function GET() {
  try {
    await requireRole("ADMIN");
    const schedules = await prisma.deletionSchedule.findMany({
      include: {
        tenant: { select: { name: true } },
        createdBy: { select: { email: true } },
        runs: {
          orderBy: { startedAt: "desc" },
          take: 1,
          select: { status: true, startedAt: true, plannedResources: true, deletedResources: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
    return NextResponse.json(schedules);
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = CreateSchema.safeParse(body);
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });

    const schedule = await prisma.deletionSchedule.create({
      data: {
        ...parsed.data,
        createdById: session.user.id,
        isEnabled: true,           // enabled from creation
        liveDeletesApproved: false, // always starts with live deletes disabled
      },
    });

    // Refresh cron registry
    await refreshDeletionSchedulers();

    return NextResponse.json(schedule, { status: 201 });
  } catch (err) {
    if (err instanceof AuthError) return NextResponse.json({ error: err.message }, { status: err.status });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
