/**
 * Next.js instrumentation hook.
 *
 * Background jobs (scheduler, automation poller) and the WebSocket terminal
 * server have been moved to the standalone worker process (`npm run worker`).
 * This file is intentionally a no-op to keep the Next.js web process clean.
 *
 * To start background services: npm run worker
 */
export async function register() {
  // No background jobs in the web process.
  // All background work is handled by worker/index.ts.
}
