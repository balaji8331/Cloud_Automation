/**
 * POST /api/tenants/:id/sync
 * Manual "Sync Now" trigger for a single tenant.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { ingestTenant } from "@/jobs/ingest";
import { writeAuditLog } from "@/lib/db/audit";
import { TenantBusyError } from "@/lib/azure/tenantQueue";

export async function POST(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");

    const body = await req.json().catch(() => ({}));
    const daysBack = Number(body.daysBack ?? 30);

    await writeAuditLog({
      userId: session.user.id,
      action: "SYNC_TENANT",
      resourceType: "tenant",
      resourceId: params.id,
    });

    const result = await ingestTenant(params.id, daysBack, { rejectIfBusy: true });
    return NextResponse.json(result, { status: result.success ? 200 : 502 });
  } catch (err: unknown) {
    if (err instanceof TenantBusyError) {
      return NextResponse.json(
        { success: false, error: err.message, busy: true },
        { status: 409 }
      );
    }
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    console.error("[sync]", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
