/**
 * Daily scheduler — runs at 02:00 UTC via node-cron.
 * Import this file in a custom Next.js server (server.ts) or a standalone Node process.
 *
 * Usage: import "@/jobs/scheduler" in your server entry point.
 */
import cron from "node-cron";
import { ingestAllTenants } from "./ingest";
import { checkBudgetAlerts } from "./budgetAlerts";
import { detectAnomalies } from "./anomaly";
import { syncAllTenantsResources } from "./syncResources";
import { syncAllAzureBudgetsJob } from "./syncBudgets";
import { refreshDeletionSchedulers } from "./deletionExecutor";

// Daily at 02:00 UTC
const CRON_SCHEDULE = process.env.INGEST_CRON ?? "0 2 * * *";

let scheduled = false;

export function startScheduler(): void {
  if (scheduled) return;
  scheduled = true;

  cron.schedule(CRON_SCHEDULE, async () => {
    console.log(`[Scheduler] Starting daily ingestion — ${new Date().toISOString()}`);

    try {
      const results = await ingestAllTenants(30);
      const ok = results.filter((r) => r.success).length;
      const fail = results.filter((r) => !r.success).length;
      console.log(`[Scheduler] Ingestion complete — ${ok} ok, ${fail} failed`);

      await checkBudgetAlerts();
      console.log("[Scheduler] Budget alerts checked");

      await detectAnomalies();
      console.log("[Scheduler] Anomaly detection complete");

      await syncAllTenantsResources();
      console.log("[Scheduler] Resource inventory sync complete");

      await syncAllAzureBudgetsJob();
      console.log("[Scheduler] Azure-native budget sync complete");
    } catch (err) {
      console.error("[Scheduler] Job failed:", err);
    }
  });

  console.log(`[Scheduler] Daily ingestion scheduled: ${CRON_SCHEDULE}`);

  // Load deletion schedules dynamically on startup
  refreshDeletionSchedulers().catch((e) =>
    console.error("[Scheduler] Failed to init deletion schedulers:", e)
  );
}
