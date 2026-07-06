/**
 * Next.js instrumentation hook — runs once when the server starts.
 * This is the correct place to bootstrap long-running background jobs
 * (cron scheduler, deletion schedulers) without a custom server.
 *
 * Docs: https://nextjs.org/docs/app/building-your-application/optimizing/instrumentation
 */
export async function register() {
  // Only run in the Node.js runtime (not in the Edge runtime)
  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Dynamic import so the scheduler module (and node-cron) is only loaded
    // server-side and never bundled into client code.
    const { startScheduler } = await import("./jobs/scheduler");
    startScheduler();
    console.log("[Instrumentation] Background scheduler started");
  }
}
