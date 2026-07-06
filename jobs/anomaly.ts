/**
 * Anomaly detection job.
 * Flags any day where a subscription's spend is X% above its 7-day trailing average.
 * Sends email alerts and logs to email_alerts table.
 */
import prisma from "@/lib/db";
import { getRecentDailyBySubscription } from "@/lib/db/costs";
import { sendEmail, anomalyAlertHtml } from "@/lib/email";

const DEFAULT_THRESHOLD = Number(process.env.DEFAULT_ANOMALY_THRESHOLD ?? 50);
const ALERT_TO = process.env.ALERT_TO_EMAIL ?? "finance@example.com";
const WINDOW = 7; // trailing days for average

export interface AnomalyResult {
  subscriptionId: string;
  subscriptionName: string;
  tenantName: string;
  date: string;
  todayCost: number;
  avgCost: number;
  spikePercent: number;
}

export async function detectAnomalies(tenantId?: string): Promise<AnomalyResult[]> {
  // Get threshold config (per-tenant or global)
  const config = tenantId
    ? await prisma.anomalyConfig.findFirst({ where: { tenantId } })
    : null;
  const globalConfig = await prisma.anomalyConfig.findFirst({
    where: { tenantId: null },
  });
  const thresholdPct = Number(
    config?.thresholdPct ?? globalConfig?.thresholdPct ?? DEFAULT_THRESHOLD
  );

  // Pull 8 days of data (7-day window + today)
  const days = await getRecentDailyBySubscription(WINDOW + 1);

  // Group by subscriptionId
  const bySubscription: Record<string, { date: string; totalCost: number }[]> = {};

  // Pre-fetch subscription→tenant mapping in one query to avoid N+1
  let allowedSubIds: Set<string> | null = null;
  if (tenantId) {
    const subs = await prisma.subscription.findMany({
      where: { tenantId },
      select: { id: true },
    });
    allowedSubIds = new Set(subs.map((s) => s.id));
  }

  for (const row of days) {
    if (allowedSubIds && !allowedSubIds.has(row.subscriptionId)) continue;
    if (!bySubscription[row.subscriptionId]) {
      bySubscription[row.subscriptionId] = [];
    }
    bySubscription[row.subscriptionId].push({
      date: row.date,
      totalCost: row.totalCost,
    });
  }

  const anomalies: AnomalyResult[] = [];

  for (const [subscriptionId, costData] of Object.entries(bySubscription)) {
    if (costData.length < 2) continue;

    // Sort ascending
    costData.sort((a, b) => a.date.localeCompare(b.date));

    // Latest day
    const today = costData[costData.length - 1];
    // Previous days for average
    const prev = costData.slice(0, -1);
    if (prev.length === 0) continue;

    const avg = prev.reduce((s, d) => s + d.totalCost, 0) / prev.length;
    if (avg <= 0) continue;

    const spikePercent = ((today.totalCost - avg) / avg) * 100;

    if (spikePercent >= thresholdPct) {
      const sub = await prisma.subscription.findUnique({
        where: { id: subscriptionId },
        include: { tenant: { select: { id: true, name: true } } },
      });

      if (!sub) continue;

      const anomaly: AnomalyResult = {
        subscriptionId,
        subscriptionName: sub.subscriptionName ?? sub.subscriptionId,
        tenantName: sub.tenant.name,
        date: today.date,
        todayCost: today.totalCost,
        avgCost: avg,
        spikePercent,
      };

      anomalies.push(anomaly);

      // Check if we already sent an alert for this subscription+date today
      const alreadySent = await prisma.emailAlert.findFirst({
        where: {
          tenantId: sub.tenantId,
          alertType: "ANOMALY",
          sentAt: { gte: new Date(today.date) },
          metadata: { path: ["subscriptionId"], equals: subscriptionId },
        },
      });

      if (!alreadySent) {
        try {
          await sendEmail({
            to: ALERT_TO,
            subject: `🚨 Cost Anomaly: ${sub.subscriptionName ?? sub.subscriptionId} (+${spikePercent.toFixed(0)}%)`,
            html: anomalyAlertHtml({
              tenantName: sub.tenant.name,
              subscriptionName: sub.subscriptionName ?? sub.subscriptionId,
              date: today.date,
              todayCost: today.totalCost,
              avgCost: avg,
              spikePercent,
              currency: "USD",
            }),
          });

          await prisma.emailAlert.create({
            data: {
              tenantId: sub.tenantId,
              alertType: "ANOMALY",
              recipientEmail: ALERT_TO,
              subject: `Cost Anomaly: ${sub.subscriptionName}`,
              metadata: {
                subscriptionId,
                date: today.date,
                todayCost: today.totalCost,
                avgCost: avg,
                spikePercent,
              },
            },
          });
        } catch (e) {
          console.error("[Anomaly] Failed to send alert:", e);
        }
      }
    }
  }

  return anomalies;
}
