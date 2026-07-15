import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { JobType, JobPriority } from "@prisma/client";

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");

    const job = await prisma.jobQueue.create({
      data: {
        jobType: JobType.GUACAMOLE_SYNC,
        priority: JobPriority.IMMEDIATE,
        createdBy: session.user.id,
      },
    });

    return NextResponse.json({ success: true, jobId: job.id });
  } catch (error: any) {
    console.error("[GuacamoleSync API] Error:", error);
    return NextResponse.json({ error: "Failed to trigger sync" }, { status: 500 });
  }
}
