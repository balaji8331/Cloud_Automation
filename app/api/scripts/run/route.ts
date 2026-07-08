import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";
import { JobType, JobPriority } from "@prisma/client";

export async function POST(req: Request) {
  try {
    const session = await requireRole("SUPER_ADMIN");
    const body = await req.json();

    const { tenantId, subscriptionId, targetResourceGroup, name, scriptType, scriptContent } = body;

    if (!tenantId || !scriptType || !scriptContent) {
      return NextResponse.json({ error: "tenantId, scriptType, and scriptContent are required" }, { status: 400 });
    }

    if (scriptContent.length > 50000) {
      return NextResponse.json({ error: "Script content exceeds 50KB limit" }, { status: 400 });
    }

    if (scriptType !== "bash" && scriptType !== "powershell") {
      return NextResponse.json({ error: "Invalid scriptType" }, { status: 400 });
    }

    // 1. Audit Log Trigger
    await writeAuditLog({
      userId: session.user.id,
      action: "SCRIPT_RUN_TRIGGERED",
      resourceType: "tenant",
      resourceId: tenantId,
      metadata: { scriptType, name, targetResourceGroup, subscriptionId }
    });

    // 2. Create ScriptRun
    const scriptRun = await prisma.scriptRun.create({
      data: {
        tenantId,
        subscriptionId,
        targetResourceGroup,
        name,
        scriptType,
        scriptContent,
        triggeredById: session.user.id,
        status: "running"
      }
    });

    // 3. Trigger JobQueue
    await prisma.jobQueue.create({
      data: {
        jobType: JobType.SCRIPT_EXECUTION,
        priority: JobPriority.IMMEDIATE,
        referenceId: scriptRun.id,
        tenantId
      }
    });

    return NextResponse.json({ success: true, runId: scriptRun.id });
  } catch (err: any) {
    if (err.status) return NextResponse.json({ error: err.message }, { status: err.status });
    console.error("[RunScript] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
