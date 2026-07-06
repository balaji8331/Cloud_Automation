/**
 * Per-tenant mutex for Azure Cost Management API calls.
 * Only one operation per Azure tenant runs at a time; additional callers queue FIFO.
 * Re-entrant: nested calls from the same async context (route → ingest → query) skip re-locking.
 */
import { AsyncLocalStorage } from "async_hooks";

export class TenantBusyError extends Error {
  constructor(
    public readonly tenantKey: string,
    public readonly currentOperation: string | null
  ) {
    super(
      currentOperation
        ? `Azure operation "${currentOperation}" already in progress for this tenant`
        : "An Azure operation is already in progress for this tenant"
    );
    this.name = "TenantBusyError";
  }
}

export interface TenantQueueStatus {
  busy: boolean;
  currentOperation: string | null;
  queuedCount: number;
  rateLimited: boolean;
  retryInSeconds: number | null;
}

interface TenantQueueEntry {
  chain: Promise<void>;
  running: boolean;
  currentOperation: string | null;
  queuedCount: number;
  rateLimitedUntil: number | null;
}

const queues = new Map<string, TenantQueueEntry>();
const activeTenantContext = new AsyncLocalStorage<string>();

function getOrCreateEntry(tenantKey: string): TenantQueueEntry {
  let entry = queues.get(tenantKey);
  if (!entry) {
    entry = {
      chain: Promise.resolve(),
      running: false,
      currentOperation: null,
      queuedCount: 0,
      rateLimitedUntil: null,
    };
    queues.set(tenantKey, entry);
  }
  return entry;
}

/** Expose live queue / rate-limit state for UI (Fix #6). */
export function getTenantQueueStatus(tenantKey: string): TenantQueueStatus {
  const entry = queues.get(tenantKey);
  if (!entry) {
    return {
      busy: false,
      currentOperation: null,
      queuedCount: 0,
      rateLimited: false,
      retryInSeconds: null,
    };
  }

  const now = Date.now();
  const retryInMs =
    entry.rateLimitedUntil && entry.rateLimitedUntil > now
      ? entry.rateLimitedUntil - now
      : null;

  return {
    busy: entry.running || entry.queuedCount > 0,
    currentOperation: entry.currentOperation,
    queuedCount: entry.queuedCount,
    rateLimited: retryInMs != null,
    retryInSeconds: retryInMs != null ? Math.ceil(retryInMs / 1000) : null,
  };
}

/** Called by the retry wrapper when backing off on 429/503. */
export function setTenantRateLimitWait(tenantKey: string, delayMs: number): void {
  const entry = getOrCreateEntry(tenantKey);
  entry.rateLimitedUntil = Date.now() + delayMs;
}

function clearTenantRateLimitWait(tenantKey: string): void {
  const entry = queues.get(tenantKey);
  if (entry) entry.rateLimitedUntil = null;
}

/**
 * Run an Azure Cost Management operation exclusively for a tenant.
 * @param rejectIfBusy  If true, return immediately instead of queueing (manual UI actions).
 */
export async function runTenantOperation<T>(
  tenantKey: string,
  operation: string,
  fn: () => Promise<T>,
  options?: { rejectIfBusy?: boolean }
): Promise<T> {
  // Re-entrant: nested cost API calls from an already-locked route share the same lock
  if (activeTenantContext.getStore() === tenantKey) {
    return fn();
  }

  const entry = getOrCreateEntry(tenantKey);

  if (options?.rejectIfBusy && (entry.running || entry.queuedCount > 0)) {
    throw new TenantBusyError(tenantKey, entry.currentOperation);
  }

  entry.queuedCount++;

  const run = entry.chain.then(async () => {
    entry.running = true;
    entry.currentOperation = operation;
    return activeTenantContext.run(tenantKey, async () => {
      try {
        return await fn();
      } finally {
        entry.running = false;
        entry.currentOperation = null;
        clearTenantRateLimitWait(tenantKey);
      }
    });
  });

  entry.chain = run.then(
    () => undefined,
    () => undefined
  );

  try {
    return await run;
  } finally {
    entry.queuedCount = Math.max(0, entry.queuedCount - 1);
  }
}
