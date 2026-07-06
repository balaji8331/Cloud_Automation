/**
 * Budget DB helpers.
 */
import prisma from "./index";
import type { Budget } from "@prisma/client";

export interface BudgetCreateInput {
  tenantId: string;
  subscriptionId?: string;
  name: string;
  amount: number;
  timeGrain?: "MONTHLY" | "QUARTERLY" | "ANNUALLY";
  startDate: Date;
  endDate?: Date;
  alertThreshold?: number;
  azureBudgetId?: string;
  scopeType?: "TENANT" | "SUBSCRIPTION" | "RESOURCE_GROUP";
  scopeId?: string;
  source?: "PORTAL" | "AZURE_NATIVE";
  azurePortalUrl?: string;
}

export async function getBudgets(tenantId?: string): Promise<Budget[]> {
  return prisma.budget.findMany({
    where: tenantId ? { tenantId } : undefined,
    orderBy: { createdAt: "desc" },
  });
}

export async function getBudgetById(id: string): Promise<Budget | null> {
  return prisma.budget.findUnique({ where: { id } });
}

export async function createBudget(input: BudgetCreateInput): Promise<Budget> {
  return prisma.budget.create({
    data: {
      tenantId: input.tenantId,
      subscriptionId: input.subscriptionId ?? null,
      name: input.name,
      amount: input.amount,
      timeGrain: input.timeGrain ?? "MONTHLY",
      startDate: input.startDate,
      endDate: input.endDate ?? null,
      alertThreshold: input.alertThreshold ?? 0.8,
      azureBudgetId: input.azureBudgetId ?? null,
      scopeType: input.scopeType ?? "TENANT",
      scopeId: input.scopeId ?? null,
      source: input.source ?? "PORTAL",
      azurePortalUrl: input.azurePortalUrl ?? null,
    },
  });
}

export async function updateBudget(
  id: string,
  input: Partial<BudgetCreateInput>
): Promise<Budget> {
  return prisma.budget.update({
    where: { id },
    data: {
      ...(input.name && { name: input.name }),
      ...(input.amount !== undefined && { amount: input.amount }),
      ...(input.timeGrain && { timeGrain: input.timeGrain }),
      ...(input.startDate && { startDate: input.startDate }),
      ...(input.endDate !== undefined && { endDate: input.endDate }),
      ...(input.alertThreshold !== undefined && {
        alertThreshold: input.alertThreshold,
      }),
    },
  });
}

export async function deleteBudget(id: string): Promise<void> {
  await prisma.budget.delete({ where: { id } });
}

/**
 * Returns budgets with their current spend percentage.
 * "Current period" = from budget.startDate to today.
 */
export async function getBudgetsWithSpend(): Promise<
  (Budget & { currentSpend: number; spendPercent: number })[]
> {
  const budgets = await prisma.budget.findMany({
    orderBy: { createdAt: "desc" },
  });

  const result = await Promise.all(
    budgets.map(async (b) => {
      const today = new Date();
      const from = b.startDate;
      const to = b.endDate && b.endDate < today ? b.endDate : today;

      const where: Record<string, unknown> = {
        tenantId: b.tenantId,
        date: { gte: from, lte: to },
      };
      if (b.subscriptionId) where.subscriptionId = b.subscriptionId;

      const agg = await prisma.costRecord.aggregate({
        _sum: { normalizedCostUsd: true },
        where,
      });

      const currentSpend = Number((agg._sum?.normalizedCostUsd ?? 0));
      const spendPercent = Number(b.amount) > 0
        ? (currentSpend / Number(b.amount)) * 100
        : 0;

      return { ...b, currentSpend, spendPercent };
    })
  );

  return result;
}
