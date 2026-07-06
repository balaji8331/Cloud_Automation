/**
 * Budget alert job — checks all budgets and sends alerts when threshold is exceeded.
 */
import prisma from "@/lib/db";
import { getBudgetsWithSpend } from "@/lib/db/budgets";
import { sendEmail, budgetAlertHtml } from "@/lib/email";

const ALERT_TO = process.env.ALERT_TO_EMAIL ?? "finance@example.com";

export async function checkBudgetAlerts(): Promise<void> {
  const budgets = await getBudgetsWithSpend();

  for (const budget of budgets) {
    const threshold = Number(budget.alertThreshold);
    const spendRatio = budget.spendPercent / 100;

    if (spendRatio < threshold) continue;

    // Check if we already alerted this budget today
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const alreadySent = await prisma.emailAlert.findFirst({
      where: {
        budgetId: budget.id,
        alertType: "BUDGET_THRESHOLD",
        sentAt: { gte: today },
      },
    });

    if (alreadySent) continue;

    const tenant = await prisma.tenant.findUnique({
      where: { id: budget.tenantId },
      select: { name: true },
    });

    try {
      await sendEmail({
        to: ALERT_TO,
        subject: `⚠️ Budget Alert: ${budget.name} at ${budget.spendPercent.toFixed(1)}%`,
        html: budgetAlertHtml({
          tenantName: tenant?.name ?? budget.tenantId,
          budgetName: budget.name,
          amount: Number(budget.amount),
          currentSpend: budget.currentSpend,
          spendPercent: budget.spendPercent,
          currency: "USD",
        }),
      });

      await prisma.emailAlert.create({
        data: {
          budgetId: budget.id,
          tenantId: budget.tenantId,
          alertType: "BUDGET_THRESHOLD",
          recipientEmail: ALERT_TO,
          subject: `Budget Alert: ${budget.name}`,
          metadata: {
            spendPercent: budget.spendPercent,
            currentSpend: budget.currentSpend,
            amount: Number(budget.amount),
          },
        },
      });

      console.log(`[Budget Alert] Sent for budget: ${budget.name}`);
    } catch (e) {
      console.error("[Budget Alert] Failed to send:", e);
    }
  }
}
