/**
 * PATCH  /api/budgets/:id  — update budget
 * DELETE /api/budgets/:id  — delete budget
 */
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole } from "@/lib/auth/guards";
import { updateBudget, deleteBudget } from "@/lib/db/budgets";
import { writeAuditLog } from "@/lib/db/audit";

const UpdateBudgetSchema = z.object({
  name: z.string().min(1).optional(),
  amount: z.number().positive().optional(),
  timeGrain: z.enum(["MONTHLY", "QUARTERLY", "ANNUALLY"]).optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  alertThreshold: z.number().min(0).max(1).optional(),
});

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");
    const body = await req.json();
    const parsed = UpdateBudgetSchema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    }

    const { startDate, endDate, ...rest } = parsed.data;
    const budget = await updateBudget(params.id, {
      ...rest,
      ...(startDate && { startDate: new Date(startDate) }),
      ...(endDate && { endDate: new Date(endDate) }),
    });

    await writeAuditLog({
      userId: session.user.id,
      action: "UPDATE_BUDGET",
      resourceType: "budget",
      resourceId: params.id,
    });

    return NextResponse.json(budget);
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } }
) {
  try {
    const session = await requireRole("ADMIN");
    await deleteBudget(params.id);

    await writeAuditLog({
      userId: session.user.id,
      action: "DELETE_BUDGET",
      resourceType: "budget",
      resourceId: params.id,
    });

    return NextResponse.json({ success: true });
  } catch (err: unknown) {
    if (err instanceof Error && "status" in err) {
      return NextResponse.json({ error: err.message }, { status: (err as { status: number }).status });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
