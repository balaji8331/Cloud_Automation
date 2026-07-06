/**
 * GET  /api/budgets         — list budgets with current spend
 * POST /api/budgets         — create a budget
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { getBudgetsWithSpend, createBudget } from "@/lib/db/budgets";
import { writeAuditLog } from "@/lib/db/audit";

const CreateBudgetSchema = z.object({
  tenantId: z.string(),
  subscriptionId: z.string().optional(),
  name: z.string().min(1),
  amount: z.number().positive(),
  timeGrain: z.enum(["MONTHLY", "QUARTERLY", "ANNUALLY"]).default("MONTHLY"),
  startDate: z.string(),
  endDate: z.string().optional(),
  alertThreshold: z.number().min(0).max(1).default(0.8),
  scopeType: z.enum(["TENANT", "SUBSCRIPTION", "RESOURCE_GROUP"]).default("TENANT"),
  scopeId: z.string().optional(),
});

export async function GET() {
  try {
    const session = await requireRole("READONLY");
    const budgets = await getBudgetsWithSpend();

    await writeAuditLog({ userId: session.user.id, action: "VIEW_BUDGETS" });

    return NextResponse.json(budgets);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = CreateBudgetSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { startDate, endDate, ...rest } = parsed.data;
    const budget = await createBudget({
      ...rest,
      startDate: new Date(startDate),
      endDate: endDate ? new Date(endDate) : undefined,
      source: "PORTAL",
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "CREATE_BUDGET",
      resourceType: "budget",
      resourceId: budget.id,
    });

    return NextResponse.json(budget, { status: 201 });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
