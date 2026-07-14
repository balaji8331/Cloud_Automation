import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";
import { encrypt } from "@/lib/crypto";

const BulkItemSchema = z.object({
  name: z.string().min(1),
  ipAddress: z.string().min(1),
  username: z.string().min(1),
  password: z.string().min(1),
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

const BulkCreateVmSchema = z.array(BulkItemSchema);

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = BulkCreateVmSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const createData = parsed.data.map(item => {
      const { password, ...data } = item;
      return {
        ...data,
        passwordEnc: encrypt(password),
      };
    });

    const result = await prisma.vmInventoryItem.createMany({
      data: createData,
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "BULK_CREATE_VM",
      resourceType: "vm_inventory",
      resourceId: "bulk",
      metadata: { count: result.count }
    });

    return NextResponse.json({ success: true, count: result.count });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
