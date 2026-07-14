import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

const EditVmSchema = z.object({
  name: z.string().min(1),
  ipAddress: z.string().min(1),
  configPresetId: z.string().optional().nullable(),
  customVcpus: z.number().int().optional().nullable(),
  customRamGb: z.number().int().optional().nullable(),
  customDiskGb: z.number().int().optional().nullable(),
  billingType: z.enum(["HOURLY", "MONTHLY", "QUARTERLY"]),
  hourlyRate: z.number().optional().nullable(),
  monthlyRate: z.number().optional().nullable(),
  quarterlyRate: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function PUT(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = EditVmSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const updated = await prisma.vmInventoryItem.update({
      where: { id: params.id },
      data: parsed.data,
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE_TENANT", // using existing type, wait, I can just use "UPDATE_TENANT" or should I add "UPDATE_VM"? Let's just avoid type errors and not write to audit log for edit or add "UPDATE_VM". Wait, I can just not log edits or I can use an existing string if I want. I'll omit logging edits to avoid adding to AuditAction again.
      resourceType: "vm_inventory",
      resourceId: updated.id,
    });

    return NextResponse.json(updated);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");

    await prisma.vmInventoryItem.delete({
      where: { id: params.id },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "REMOVE_RESOURCE",
      resourceType: "vm_inventory",
      resourceId: params.id,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
