import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

const CreateAssignmentSchema = z.object({
  assignedTo: z.string().min(1),
  trainingName: z.string().optional(),
  startDate: z.string(),
  endDate: z.string(),
});

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN"); 
    const body = await req.json();
    const parsed = CreateAssignmentSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { assignedTo, trainingName, startDate, endDate } = parsed.data;
    const start = new Date(startDate);
    const end = new Date(endDate);

    if (end < start) {
      return NextResponse.json({ error: "End date cannot be before start date" }, { status: 400 });
    }

    const overlaps = await prisma.vmAssignment.findFirst({
      where: {
        vmInventoryItemId: params.id,
        startDate: { lte: end },
        endDate: { gte: start },
      },
    });

    if (overlaps) {
      return NextResponse.json({ error: "VM is already assigned during this period" }, { status: 409 });
    }

    const assignment = await prisma.vmAssignment.create({
      data: {
        vmInventoryItemId: params.id,
        assignedTo,
        trainingName,
        startDate: start,
        endDate: end,
        createdById: session.user.id,
      },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE_VM_ASSIGNMENT",
      resourceType: "vm_assignment",
      resourceId: assignment.id,
    });

    return NextResponse.json(assignment);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
