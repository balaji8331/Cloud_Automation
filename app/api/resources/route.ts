/**
 * GET  /api/resources        — list resources with filters
 * POST /api/resources/:id/remove — soft-delete (portal-only)
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";

export async function GET(req: Request) {
  try {
    // BUG FIX 4: AuthError is caught and returned as proper 401/403, not swallowed
    const session = await requireRole("READONLY");
    const { searchParams } = new URL(req.url);

    const tenantId = searchParams.get("tenantId") ?? undefined;
    const subscriptionId = searchParams.get("subscriptionId") ?? undefined;
    const resourceGroupId = searchParams.get("resourceGroupId") ?? undefined;
    const type = searchParams.get("type") ?? undefined;
    const search = searchParams.get("search") ?? undefined;
    const orphaned = searchParams.get("orphaned") === "true";
    const showRemoved = searchParams.get("showRemoved") === "true";

    // BUG FIX: log every request so we can see filters applied — remove debug log in production
    const where: any = {}; // eslint-disable-line @typescript-eslint/no-explicit-any

    // showRemoved=true shows manually removed items too, default hides them
    if (showRemoved) {
      where.isActive = false;
      where.manuallyRemoved = true;
    } else {
      where.isActive = true;
      where.manuallyRemoved = false;
    }

    if (tenantId) where.tenantId = tenantId;
    if (subscriptionId) where.subscriptionId = subscriptionId;
    if (resourceGroupId) where.resourceGroupId = resourceGroupId;
    if (type && type !== "all") where.type = { contains: type, mode: "insensitive" };
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { type: { contains: search, mode: "insensitive" } },
        { location: { contains: search, mode: "insensitive" } },
      ];
    }

    if (orphaned) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 30);
      const activeSubIds = await prisma.costRecord.groupBy({
        by: ["subscriptionId"],
        where: { date: { gte: cutoff } },
      });
      const activeIds = new Set(activeSubIds.map((r) => r.subscriptionId));
      where.subscriptionId = { notIn: Array.from(activeIds) };
    }

    const resources = await prisma.resource.findMany({
      where,
      include: {
        tenant: { select: { name: true } },
        subscription: { select: { subscriptionId: true, subscriptionName: true } },
        resourceGroup: { select: { name: true } },
      },
      orderBy: [{ type: "asc" }, { name: "asc" }],
      take: 500,
    });

    // MTD cost per resource group
    const today = new Date();
    const mtdFrom = new Date(today.getFullYear(), today.getMonth(), 1);

    const mtdCosts = await prisma.costRecord.groupBy({
      by: ["subscriptionId", "resourceGroup"],
      where: {
        date: { gte: mtdFrom },
        ...(tenantId && { tenantId }),
      },
      _sum: { cost: true },
    });

    const costMap = new Map<string, number>();
    for (const c of mtdCosts) {
      costMap.set(`${c.subscriptionId}:${c.resourceGroup?.toLowerCase()}`, Number(c._sum.cost ?? 0));
    }

    const enriched = resources.map((r) => ({
      id: r.id,
      resourceId: r.resourceId,
      name: r.name,
      type: r.type,
      location: r.location,
      provisioningState: r.provisioningState,
      tags: r.tags,
      sku: r.sku,
      isActive: r.isActive,
      manuallyRemoved: r.manuallyRemoved,
      lastSyncedAt: r.lastSyncedAt,
      tenantName: r.tenant.name,
      subscriptionName: r.subscription.subscriptionName ?? r.subscription.subscriptionId,
      resourceGroupName: r.resourceGroup.name,
      // BUG CHECK 3: costMap key uses internal subscriptionId (DB UUID), which matches
      // what cost_records stores — correct, no mismatch
      mtdCost: costMap.get(`${r.subscriptionId}:${r.resourceGroup.name.toLowerCase()}`) ?? 0,
    }));

    return NextResponse.json(enriched);
  } catch (err: unknown) {
    // BUG FIX 4: return proper HTTP status, never a 200 with empty array
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[GET /api/resources] unhandled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
