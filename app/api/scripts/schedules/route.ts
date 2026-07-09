import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";
import { CronExpressionParser } from "cron-parser";

export async function GET(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    
    // Admins see all schedules, others could be scoped but currently only Super Admin manages scripts.
    const schedules = await prisma.scriptSchedule.findMany({
      include: {
        tenant: { select: { name: true } },
        createdBy: { select: { email: true } },
      },
      orderBy: { createdAt: "desc" }
    });

    return NextResponse.json(schedules);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN");
    const body = await req.json();

    const { tenantId, subscriptionId, targetResourceGroup, name, description, scriptType, scriptContent, cronExpression } = body;

    if (!tenantId || !scriptType || !scriptContent || !cronExpression || !name) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }

    let nextRunAt: Date;
    try {
      const crons = cronExpression.split("\n").filter(Boolean);
      let earliestNext: Date | null = null;
      for (const cronStr of crons) {
        const interval = CronExpressionParser.parse(cronStr, { tz: "UTC" });
        const nextDate = interval.next().toDate();
        if (!earliestNext || nextDate < earliestNext) {
          earliestNext = nextDate;
        }
      }
      if (!earliestNext) throw new Error("Empty cron expression");
      nextRunAt = earliestNext;
    } catch (e) {
      return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 });
    }

    const schedule = await prisma.scriptSchedule.create({
      data: {
        tenantId,
        subscriptionId,
        targetResourceGroup,
        name,
        description,
        scriptType,
        scriptContent,
        cronExpression,
        nextRunAt,
        createdById: session.user.id
      }
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "SCRIPT_SCHEDULE_CREATED",
      resourceType: "tenant",
      resourceId: tenantId,
      metadata: { scheduleId: schedule.id, name, cronExpression }
    });

    return NextResponse.json(schedule);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
