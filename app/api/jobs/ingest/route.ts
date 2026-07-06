/**
 * POST /api/jobs/ingest
 * Trigger full ingestion for all tenants (used by scheduler or manual trigger).
 * Protected by ADMIN role.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { ingestAllTenants } from "@/jobs/ingest";
import { checkBudgetAlerts } from "@/jobs/budgetAlerts";

export async function POST() {
  try {
    await requireRole("ADMIN");

    const results = await ingestAllTenants(30);
    await checkBudgetAlerts();

    const tenants = results.map((r) => ({
      tenant: r.tenantName,
      tenantId: r.tenantId,
      status: r.success ? ("success" as const) : ("failed" as const),
      recordsIngested: r.recordsIngested,
      ...(r.error ? { error: r.error } : {}),
    }));

    const hasFailures = tenants.some((t) => t.status === "failed");
    const status = hasFailures ? 207 : 200;

    return NextResponse.json({ hasFailures, tenants, results }, { status });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
