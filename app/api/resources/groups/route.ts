/**
 * GET /api/resources/groups
 * Returns resource groups with resource counts and MTD cost.
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import prisma from "@/lib/db";

export async function GET(req: Request) {
  try {
    const session = await requireRole("READONLY");
    const { searchParams } = new URL(req.url);
    const tenantId = searchParams.get("tenantId") ?? undefined;
    const subscriptionId = searchParams.get("subscriptionId") ?? undefined;
    const showRemoved = searchParams.get("showRemoved") === "true";

    const groups = await prisma.resourceGroup.findMany({
      where: {
        isActive: showRemoved ? false : true,
        ...(tenantId && { tenantId }),
        ...(subscriptionId && { subscriptionId }),
      },
      include: {
        tenant: { select: { name: true } },
        subscription: { select: { subscriptionId: true, subscriptionName: true } },
      },
      orderBy: [{ name: "asc" }],
    });

    // Resource counts per group
    const resourceCounts = await prisma.resource.groupBy({
      by: ["resourceGroupId"],
      where: {
        isActive: true,
        ...(tenantId && { tenantId }),
      },
      _count: { id: true },
    });
    const countMap = new Map(resourceCounts.map((r) => [r.resourceGroupId, r._count.id]));

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

    // Resource type breakdown per group
    const typeCounts = await prisma.resource.groupBy({
      by: ["resourceGroupId", "type"],
      where: {
        isActive: true,
        ...(tenantId && { tenantId }),
      },
      _count: { id: true },
    });

    const typeMap = new Map<string, Record<string, number>>();
    for (const t of typeCounts) {
      if (!typeMap.has(t.resourceGroupId)) typeMap.set(t.resourceGroupId, {});
      typeMap.get(t.resourceGroupId)![t.type] = t._count.id;
    }

    const enriched = groups.map((g) => ({
      id: g.id,
      name: g.name,
      location: g.location,
      tags: g.tags,
      tenantId: g.tenantId,
      tenantName: g.tenant.name,
      subscriptionId: g.subscriptionId,
      subscriptionName: g.subscription.subscriptionName ?? g.subscription.subscriptionId,
      resourceCount: countMap.get(g.id) ?? 0,
      typeBreakdown: typeMap.get(g.id) ?? {},
      mtdCost: costMap.get(`${g.subscriptionId}:${g.name.toLowerCase()}`) ?? 0,
      lastSyncedAt: g.lastSyncedAt,
      isActive: g.isActive,
    }));

    return NextResponse.json(enriched);
  } catch (err: unknown) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    console.error("[GET /api/resources/groups] unhandled error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
