/**
 * Email alerts via Resend.
 * Swap the send() call here to use SMTP or SES without changing callers.
 */
import { Resend } from "resend";

let resend: Resend | null = null;

function getResendClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY is required to send email");
  }

  resend ??= new Resend(apiKey);
  return resend;
}

export interface EmailPayload {
  to?: string;
  subject: string;
  html: string;
}

export async function sendEmail(payload: EmailPayload): Promise<void> {
  const { data, error } = await getResendClient().emails.send({
    from: process.env.ALERT_FROM_EMAIL ?? "alerts@example.com",
    to: payload.to ?? process.env.ALERT_TO_EMAIL ?? "finance@example.com",
    subject: payload.subject,
    html: payload.html,
  });

  if (error) {
    throw new Error(`Resend error: ${JSON.stringify(error)}`);
  }

  console.log(`[Email] Sent: ${payload.subject} → id=${data?.id}`);
}

// ─── Templates ────────────────────────────────────────────────────────────────

export function budgetAlertHtml(params: {
  tenantName: string;
  budgetName: string;
  amount: number;
  currentSpend: number;
  spendPercent: number;
  currency: string;
}): string {
  const color = params.spendPercent >= 100 ? "#ef4444" : params.spendPercent >= 80 ? "#f59e0b" : "#22c55e";
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:${color}">⚠️ Budget Alert: ${params.budgetName}</h2>
      <p>Tenant: <strong>${params.tenantName}</strong></p>
      <p>Budget: <strong>${params.currency} ${params.amount.toLocaleString()}</strong></p>
      <p>Current Spend: <strong>${params.currency} ${params.currentSpend.toLocaleString()}</strong>
         (<strong>${params.spendPercent.toFixed(1)}%</strong>)</p>
      <div style="background:#e5e7eb;border-radius:4px;height:20px;margin:12px 0">
        <div style="background:${color};width:${Math.min(params.spendPercent, 100)}%;height:100%;border-radius:4px"></div>
      </div>
      <p style="color:#6b7280;font-size:12px">Azure Cost &amp; Billing Portal</p>
    </div>
  `;
}

export function anomalyAlertHtml(params: {
  tenantName: string;
  subscriptionName: string;
  date: string;
  todayCost: number;
  avgCost: number;
  spikePercent: number;
  currency: string;
}): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
      <h2 style="color:#ef4444">🚨 Cost Anomaly Detected</h2>
      <p>Tenant: <strong>${params.tenantName}</strong></p>
      <p>Subscription: <strong>${params.subscriptionName}</strong></p>
      <p>Date: <strong>${params.date}</strong></p>
      <p>Today's cost: <strong>${params.currency} ${params.todayCost.toFixed(2)}</strong></p>
      <p>7-day average: <strong>${params.currency} ${params.avgCost.toFixed(2)}</strong></p>
      <p style="color:#ef4444">Spike: <strong>+${params.spikePercent.toFixed(1)}%</strong> above average</p>
      <p style="color:#6b7280;font-size:12px">Azure Cost &amp; Billing Portal</p>
    </div>
  `;
}
