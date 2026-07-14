import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import prisma from "@/lib/db";
import { writeAuditLog } from "@/lib/db/audit";

const BulkDeleteSchema = z.object({
  ids: z.array(z.string()),
});

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = BulkDeleteSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { ids } = parsed.data;

    const result = await prisma.vmInventoryItem.deleteMany({
      where: {
        id: { in: ids }
      }
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "BULK_REMOVE_RESOURCE",
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
