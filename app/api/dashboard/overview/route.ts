/**
 * GET /api/dashboard/overview?range=30d
 * Returns combined cost metrics for the overview dashboard.
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import { writeAuditLog } from "@/lib/db/audit";
import {
  getTotalCost,
  getDailyCosts,
  getCostByTenant,
  getCostByService,
} from "@/lib/db/costs";
import { getDateRange, type DateRange } from "@/lib/utils";

export async function GET(req: Request) {
  try {
    const session = await requireRole("READONLY");

    const { searchParams } = new URL(req.url);
    const range = (searchParams.get("range") ?? "30d") as DateRange;
    const customFrom = searchParams.get("from");
    const customTo = searchParams.get("to");

    const { from, to } = getDateRange(
      range,
      customFrom ? new Date(customFrom) : undefined,
      customTo ? new Date(customTo) : undefined
    );

    const [totalCost, dailyCosts, byTenant, byService] = await Promise.all([
      getTotalCost(from, to),
      getDailyCosts({ from, to }),
      getCostByTenant(from, to),
      getCostByService({ from, to }),
    ]);

    // Skip audit log for dashboard reads — too frequent, not useful
    // await writeAuditLog({ userId: session.user.id, action: "VIEW_DASHBOARD", metadata: { range } });

    return NextResponse.json({
      totalCost,
      dailyCosts,
      byTenant,
      byService,
      range,
      from: from.toISOString(),
      to: to.toISOString(),
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
