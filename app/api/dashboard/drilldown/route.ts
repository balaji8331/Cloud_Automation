/**
 * GET /api/dashboard/drilldown
 * Drill-down cost data with filters:
 *   ?tenantId=&subscriptionId=&resourceGroup=&from=&to=
 */
import { NextResponse } from "next/server";
import { requireRole } from "@/lib/auth/guards";
import {
  getDailyCosts,
  getCostByService,
  getCostByResourceGroup,
} from "@/lib/db/costs";
import { getDateRange, type DateRange } from "@/lib/utils";

export async function GET(req: Request) {
  try {
    await requireRole("READONLY");

    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") ?? undefined;
    const subscriptionId = searchParams.get("subscriptionId") ?? undefined;
    const resourceGroup = searchParams.get("resourceGroup") ?? undefined;
    const range = (searchParams.get("range") ?? "30d") as DateRange;
    const customFrom = searchParams.get("from");
    const customTo = searchParams.get("to");

    const { from, to } = getDateRange(
      range,
      customFrom ? new Date(customFrom) : undefined,
      customTo ? new Date(customTo) : undefined
    );

    const params = { tenantId, subscriptionId, resourceGroup, from, to };

    const [dailyCosts, byService, byResourceGroup] = await Promise.all([
      getDailyCosts(params),
      getCostByService(params),
      getCostByResourceGroup(params),
    ]);

    return NextResponse.json({
      dailyCosts,
      byService,
      byResourceGroup,
      filters: { tenantId, subscriptionId, resourceGroup, range },
    });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
