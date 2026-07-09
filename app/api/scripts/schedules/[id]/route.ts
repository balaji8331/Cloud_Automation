import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";
import { CronExpressionParser } from "cron-parser";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole("SUPER_ADMIN");
    const body = await req.json();

    const { isEnabled, cronExpression } = body;
    const dataToUpdate: any = {};

    if (isEnabled !== undefined) dataToUpdate.isEnabled = isEnabled;
    
    if (cronExpression) {
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
        dataToUpdate.cronExpression = cronExpression;
        dataToUpdate.nextRunAt = earliestNext;
      } catch (e) {
        return NextResponse.json({ error: "Invalid cron expression" }, { status: 400 });
      }
    }

    const schedule = await prisma.scriptSchedule.update({
      where: { id: params.id },
      data: dataToUpdate
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "SCRIPT_SCHEDULE_UPDATED",
      resourceType: "tenant",
      resourceId: schedule.tenantId,
      metadata: { scheduleId: schedule.id, updates: dataToUpdate }
    });

    return NextResponse.json(schedule);
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  try {
    const session = await requireRole("SUPER_ADMIN");
    
    const schedule = await prisma.scriptSchedule.findUnique({ where: { id: params.id } });
    if (!schedule) return NextResponse.json({ error: "Not found" }, { status: 404 });

    await prisma.scriptSchedule.delete({ where: { id: params.id } });

    await writeAuditLog({
      userId: session.user.id,
      action: "SCRIPT_SCHEDULE_DELETED",
      resourceType: "tenant",
      resourceId: schedule.tenantId,
      metadata: { scheduleId: schedule.id }
    });

    return NextResponse.json({ success: true });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
