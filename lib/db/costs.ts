/**
 * Cost record DB helpers.
 */
import prisma from "./index";
import type { Prisma } from "@prisma/client";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CostRecordInput {
  tenantId: string;
  subscriptionId: string; // internal Subscription UUID
  date: Date;
  resourceGroup?: string;
  serviceName?: string;
  cost: number;
  currency?: string;
  normalizedCostUsd?: number; // pre-computed USD equivalent
}

export interface CostQueryParams {
  tenantId?: string;
  subscriptionId?: string;
  resourceGroup?: string;
  serviceName?: string;
  from: Date;
  to: Date;
}

export interface DailyCost {
  date: string;
  cost: number;
  currency: string;
}

export interface TenantCostSummary {
  tenantId: string;
  tenantName: string;
  totalCost: number;
  currency: string;
}

export interface SubscriptionCostSummary {
  subscriptionId: string;
  subscriptionName: string;
  totalCost: number;
  currency: string;
}

export interface ServiceCostSummary {
  serviceName: string;
  totalCost: number;
}

// ─── Write ────────────────────────────────────────────────────────────────────

/**
 * Bulk upsert cost records for a date range + subscription.
 * Clears existing records for the date range first to avoid duplicates.
 */
export async function upsertCostRecords(
  records: CostRecordInput[]
): Promise<number> {
  if (records.length === 0) return 0;

  // Group by subscriptionId + date to delete stale data
  const keys = Array.from(new Set(records.map((r) => `${r.subscriptionId}:${r.date.toISOString().split("T")[0]}`)));

  await prisma.$transaction(async (tx) => {
    for (const key of keys) {
      const [subId, dateStr] = key.split(":");
      await tx.costRecord.deleteMany({
        where: {
          subscriptionId: subId,
          date: new Date(dateStr),
        },
      });
    }

    await tx.costRecord.createMany({
      data: records.map((r) => ({
        tenantId: r.tenantId,
        subscriptionId: r.subscriptionId,
        date: r.date,
        resourceGroup: r.resourceGroup ?? null,
        serviceName: r.serviceName ?? null,
        cost: r.cost,
        currency: r.currency ?? "USD",
        normalizedCostUsd: r.normalizedCostUsd ?? r.cost,
      })),
    });
  });

  return records.length;
}

// ─── Read ─────────────────────────────────────────────────────────────────────

/** Total cost in a date range for a given scope — in USD */
export async function getTotalCost(params: CostQueryParams): Promise<number> {
  const where = buildWhere(params);

  // COALESCE: use normalizedCostUsd when it has been populated (> 0), otherwise fall back to raw cost
  // This handles records ingested before the currency normalization migration
  const result = await prisma.costRecord.aggregate({
    _sum: { normalizedCostUsd: true, cost: true },
    where,
  });
  const normalized = Number(result._sum?.normalizedCostUsd ?? 0);
  const raw = Number(result._sum?.cost ?? 0);
  return normalized > 0 ? normalized : raw;
}

/** Daily cost breakdown across all (or filtered) tenants — in USD */
export async function getDailyCosts(params: CostQueryParams): Promise<DailyCost[]> {
  const where: Prisma.CostRecordWhereInput = buildWhere(params);

  const rows = await prisma.costRecord.groupBy({
    by: ["date"],
    where,
    _sum: { normalizedCostUsd: true, cost: true },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => {
    const normalized = Number(r._sum?.normalizedCostUsd ?? 0);
    const raw = Number(r._sum?.cost ?? 0);
    return {
      date: r.date.toISOString().split("T")[0],
      cost: normalized > 0 ? normalized : raw,
      currency: "USD",
    };
  });
}

/** Cost per tenant — in USD */
export async function getCostByTenant(
  from: Date,
  to: Date
): Promise<TenantCostSummary[]> {
  const rows = await prisma.costRecord.groupBy({
    by: ["tenantId"],
    where: { date: { gte: from, lte: to } },
    _sum: { normalizedCostUsd: true, cost: true },
    orderBy: { tenantId: "asc" },
  });

  const tenants = await prisma.tenant.findMany({ select: { id: true, name: true } });
  const nameMap = new Map(tenants.map((t) => [t.id, t.name]));

  return rows.map((r) => {
    const normalized = Number(r._sum?.normalizedCostUsd ?? 0);
    const raw = Number(r._sum?.cost ?? 0);
    return {
      tenantId: r.tenantId,
      tenantName: nameMap.get(r.tenantId) ?? r.tenantId,
      totalCost: normalized > 0 ? normalized : raw,
      currency: "USD",
    };
  });
}

/** Cost per subscription within a tenant — in USD */
export async function getCostBySubscription(
  tenantId: string,
  from: Date,
  to: Date
): Promise<SubscriptionCostSummary[]> {
  const rows = await prisma.costRecord.groupBy({
    by: ["subscriptionId"],
    where: { tenantId, date: { gte: from, lte: to } },
    _sum: { normalizedCostUsd: true, cost: true },
    orderBy: { subscriptionId: "asc" },
  });

  const subscriptions = await prisma.subscription.findMany({ 
    where: { tenantId },
    select: { id: true, subscriptionName: true, subscriptionId: true } 
  });
  
  const nameMap = new Map(subscriptions.map((s) => [
    s.id, 
    s.subscriptionName ?? s.subscriptionId
  ]));

  return rows.map((r) => {
    const normalized = Number(r._sum?.normalizedCostUsd ?? 0);
    const raw = Number(r._sum?.cost ?? 0);
    return {
      subscriptionId: r.subscriptionId,
      subscriptionName: nameMap.get(r.subscriptionId) ?? r.subscriptionId,
      totalCost: normalized > 0 ? normalized : raw,
      currency: "USD",
    };
  });
}

/** Cost per service (meter category) — in USD */
export async function getCostByService(
  params: CostQueryParams
): Promise<ServiceCostSummary[]> {
  const where = buildWhere(params);

  const rows = await prisma.costRecord.groupBy({
    by: ["serviceName"],
    where,
    _sum: { normalizedCostUsd: true, cost: true },
    orderBy: { _sum: { cost: "desc" } },
  });

  return rows.map((r) => {
    const normalized = Number(r._sum?.normalizedCostUsd ?? 0);
    const raw = Number(r._sum?.cost ?? 0);
    return {
      serviceName: r.serviceName ?? "Unknown",
      totalCost: normalized > 0 ? normalized : raw,
    };
  });
}

/** Cost per resource group (for drill-down) — in USD */
export async function getCostByResourceGroup(
  params: CostQueryParams
): Promise<{ resourceGroup: string; totalCost: number }[]> {
  const where = buildWhere(params);

  const rows = await prisma.costRecord.groupBy({
    by: ["resourceGroup"],
    where,
    _sum: { normalizedCostUsd: true, cost: true },
    orderBy: { _sum: { cost: "desc" } },
  });

  return rows.map((r) => {
    const normalized = Number(r._sum?.normalizedCostUsd ?? 0);
    const raw = Number(r._sum?.cost ?? 0);
    return {
      resourceGroup: r.resourceGroup ?? "Unassigned",
      totalCost: normalized > 0 ? normalized : raw,
    };
  });
}

/** Raw records for export — includes both original and normalized cost */
export async function getCostRecordsForExport(params: CostQueryParams) {
  return prisma.costRecord.findMany({
    where: buildWhere(params),
    include: {
      tenant: { select: { name: true } },
      subscription: { select: { subscriptionName: true, subscriptionId: true } },
    },
    orderBy: [{ date: "asc" }, { normalizedCostUsd: "desc" }],
  });
}

// ─── Anomaly helpers ─────────────────────────────────────────────────────────

/** Returns daily totals per subscription for the last N days — in USD */
export async function getRecentDailyBySubscription(days: number): Promise<
  { subscriptionId: string; date: string; totalCost: number }[]
> {
  const from = new Date();
  from.setDate(from.getDate() - days);

  const rows = await prisma.costRecord.groupBy({
    by: ["subscriptionId", "date"],
    where: { date: { gte: from } },
    _sum: { normalizedCostUsd: true, cost: true },
    orderBy: [{ subscriptionId: "asc" }, { date: "asc" }],
  });

  return rows.map((r) => {
    const normalized = Number(r._sum?.normalizedCostUsd ?? 0);
    const raw = Number(r._sum?.cost ?? 0);
    return {
      subscriptionId: r.subscriptionId,
      date: r.date.toISOString().split("T")[0],
      totalCost: normalized > 0 ? normalized : raw,
    };
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function buildWhere(params: CostQueryParams): Prisma.CostRecordWhereInput {
  const where: Prisma.CostRecordWhereInput = {
    date: { gte: params.from, lte: params.to },
  };
  if (params.tenantId) where.tenantId = params.tenantId;
  if (params.subscriptionId) where.subscriptionId = params.subscriptionId;
  if (params.resourceGroup) where.resourceGroup = params.resourceGroup;
  if (params.serviceName) where.serviceName = params.serviceName;
  return where;
}
