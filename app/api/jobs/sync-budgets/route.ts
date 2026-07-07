/**
 * POST /api/jobs/sync-budgets
 * Manually trigger Azure-native budget sync for all connected tenants.
 * Protected by ADMIN role.
 */
import { NextResponse } from "next/server";
import { requireRole, AuthError } from "@/lib/auth/guards";
import { syncAllAzureBudgetsJob } from "@/jobs/syncBudgets";

export async function POST() {
  try {
    await requireRole("ADMIN");
    await syncAllAzureBudgetsJob();
    return NextResponse.json({ success: true, message: "Azure budgets synced successfully." });
  } catch (err) {
    if (err instanceof AuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    const message = err instanceof Error ? err.message : String(err);
    console.error("[BudgetSync API] Error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
