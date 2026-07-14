import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";
import { decrypt } from "@/lib/crypto";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN"); 
    
    const vm = await prisma.vmInventoryItem.findUnique({
      where: { id: params.id },
      select: { passwordEnc: true, name: true },
    });

    if (!vm) {
      return NextResponse.json({ error: "VM not found" }, { status: 404 });
    }

    const password = decrypt(vm.passwordEnc);

    await writeAuditLog({
      userId: session.user.id,
      action: "AZURE_VM_PASSWORD_REVEAL",
      resourceType: "vm_inventory",
      resourceId: params.id,
    });

    return NextResponse.json({ password });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as any).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
