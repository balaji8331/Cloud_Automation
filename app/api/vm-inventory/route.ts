import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";
import { encrypt } from "@/lib/crypto";

export async function GET(req: Request) {
  try {
    // Using READONLY to allow all authenticated users to see inventory
    await requireRole("READONLY"); 
    
    const { searchParams } = new URL(req.url);
    const startParam = searchParams.get("startDate");
    const endParam = searchParams.get("endDate");

    let assignmentsInclude: any = true;
    if (startParam && endParam) {
      assignmentsInclude = {
        where: {
          startDate: { lte: new Date(endParam) },
          endDate: { gte: new Date(startParam) },
        },
      };
    }

    const items = await prisma.vmInventoryItem.findMany({
      include: {
        configPreset: true,
        assignments: assignmentsInclude,
      },
      orderBy: { createdAt: "desc" },
    });

    // Strip passwords before returning
    const safeItems = items.map((item) => {
      const { passwordEnc, ...rest } = item;
      return rest;
    });

    return NextResponse.json(safeItems);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

const CreateVmSchema = z.object({
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

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = CreateVmSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { password, ...data } = parsed.data;
    const passwordEnc = encrypt(password);

    const vm = await prisma.vmInventoryItem.create({
      data: {
        ...data,
        passwordEnc,
      },
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE_VM",
      resourceType: "vm_inventory",
      resourceId: vm.id,
    });

    const { passwordEnc: _stripped, ...safeVm } = vm;
    return NextResponse.json(safeVm);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
