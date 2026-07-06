/**
 * POST /api/resources/sync?tenantId=xxx
 * Manual "Sync Resources Now" trigger.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { syncTenantResources } from "@/jobs/syncResources";
import { writeAuditLog } from "@/lib/db/audit";

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId");

    if (!tenantId) {
      return NextResponse.json({ error: "tenantId required" }, { status: 400 });
    }

    await writeAuditLog({
      userId: session.user.id,
      action: "SYNC_TENANT",
      resourceType: "resource_inventory",
      resourceId: tenantId,
    });

    const result = await syncTenantResources(tenantId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
