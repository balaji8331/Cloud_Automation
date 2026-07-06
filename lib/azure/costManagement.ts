/**
 * Azure Cost Management Query API wrapper.
 * Docs: https://learn.microsoft.com/en-us/rest/api/cost-management/query/usage
 *
 * Required role: Cost Management Reader (or Reader) on each subscription.
 */
import axios from "axios";
import { getAzureAccessToken, type AzureCredentialConfig } from "./auth";
import { runTenantOperation, setTenantRateLimitWait } from "./tenantQueue";

const ARM_BASE = "https://management.azure.com";
const API_VERSION = "2023-11-01";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CostQueryRow {
  date: string;         // YYYY-MM-DD
  resourceGroup: string;
  serviceName: string;  // PreTaxCost meter category
  cost: number;
  currency: string;
}

interface ArmQueryResponse {
  properties: {
    columns: { name: string; type: string }[];
    rows: (string | number)[][];
    nextLink?: string;
  };
}

// ─── Retry helper ─────────────────────────────────────────────────────────────

const MAX_RETRY_DELAY_MS = 60_000;
/** Stop retrying after this many consecutive 429s — back off the tenant instead of hammering. */
const MAX_CONSECUTIVE_429 = 2;

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse Azure's Retry-After header.
 * Returns delay in ms, or null if missing/unparseable.
 * Supports integer seconds or HTTP-date (RFC 7231).
 */
function parseRetryAfterMs(header: string | string[] | undefined): number | null {
  if (!header) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;

  const trimmed = raw.trim();

  // Seconds form (most common from Azure)
  const seconds = Number(trimmed);
  if (!Number.isNaN(seconds) && seconds >= 0 && /^\d+(\.\d+)?$/.test(trimmed)) {
    return seconds * 1000;
  }

  // HTTP-date form: "Wed, 21 Oct 2015 07:28:00 GMT"
  const dateMs = Date.parse(trimmed);
  if (!Number.isNaN(dateMs)) {
    return Math.max(0, dateMs - Date.now());
  }

  return null;
}

function capDelay(ms: number): number {
  return Math.min(ms, MAX_RETRY_DELAY_MS);
}

/**
 * Retry an async function with exponential backoff.
 * Handles 429 (rate limit) and 503 (service unavailable).
 *
 * @param maxAttempts Total tries (initial + retries). Default 4 = up to 4 attempts.
 */
async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 4,
  baseDelayMs = 2000,
  tenantKey?: string
): Promise<T> {
  let lastError: unknown;
  let consecutive429 = 0;
  let effectiveMaxAttempts = maxAttempts;

  for (let attempt = 0; attempt < effectiveMaxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        // Retry on 429 (rate limit) or 503 (service unavailable)
        if (status === 429 || status === 503) {
          if (status === 429) {
            consecutive429++;
            // Repeated 429s → reduce remaining attempts so we back off the tenant
            if (consecutive429 >= MAX_CONSECUTIVE_429) {
              effectiveMaxAttempts = Math.min(effectiveMaxAttempts, attempt + 1);
              console.warn(
                `[Azure] ${consecutive429} consecutive 429s — limiting to ${effectiveMaxAttempts} total attempt(s)`
              );
            }
          }

          const isLastAttempt = attempt >= effectiveMaxAttempts - 1;
          if (isLastAttempt) break;

          const retryAfterMs = parseRetryAfterMs(err.response?.headers?.["retry-after"]);
          const backoffMs = baseDelayMs * Math.pow(2, attempt);
          const delayMs = capDelay(retryAfterMs ?? backoffMs);
          const delaySource = retryAfterMs != null ? "Retry-After" : "exponential backoff";

          console.warn(
            `[Azure] ${status} rate limit hit. Waiting ${Math.round(delayMs / 1000)}s via ${delaySource} (attempt ${attempt + 1}/${effectiveMaxAttempts})`
          );
          if (tenantKey) setTenantRateLimitWait(tenantKey, delayMs);
          await sleep(delayMs);
          continue;
        }
      }
      throw err; // non-retryable error
    }
  }
  throw lastError;
}

// ─── Query ────────────────────────────────────────────────────────────────────

/**
 * Query daily cost data for a subscription in a date range.
 * Granularity = Daily, grouped by ResourceGroup + ServiceName.
 */
export async function queryCostBySubscription(
  config: AzureCredentialConfig,
  subscriptionId: string, // Azure subscription GUID
  from: Date,
  to: Date
): Promise<CostQueryRow[]> {
  const token = await getAzureAccessToken(config);

  const url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.CostManagement/query?api-version=${API_VERSION}`;

  const body = {
    type: "ActualCost",
    timeframe: "Custom",
    timePeriod: {
      from: toAzureDate(from),
      to: toAzureDate(to),
    },
    dataset: {
      granularity: "Daily",
      aggregation: {
        totalCost: {
          name: "PreTaxCost",
          function: "Sum",
        },
      },
      grouping: [
        { type: "Dimension", name: "ResourceGroup" },
        { type: "Dimension", name: "ServiceName" },
      ],
    },
  };

  const tenantKey = config.azureTenantId;
  const rows: CostQueryRow[] = [];
  let nextLink: string | null = null;
  let isFirst = true;
  let currentUrl: string = url;

  do {
    const fetchUrl = currentUrl;
    const response = await runTenantOperation(tenantKey, "cost-query", () =>
      withRetry(
        () =>
          axios.post<ArmQueryResponse>(
            fetchUrl,
            isFirst ? body : undefined,
            {
              headers: {
                Authorization: `Bearer ${token}`,
                "Content-Type": "application/json",
              },
            }
          ),
        4,
        2000,
        tenantKey
      )
    );

    const { columns, rows: rawRows, nextLink: next } = response.data.properties;

    // Map column names to indexes
    const colIndex: Record<string, number> = {};
    columns.forEach((col, i) => {
      colIndex[col.name] = i;
    });

    for (const row of rawRows) {
      // Azure returns date as integer YYYYMMDD
      const rawDate = String(row[colIndex["UsageDate"] ?? colIndex["BillingMonth"] ?? 0]);
      const date = parseAzureDate(rawDate);
      rows.push({
        date,
        resourceGroup: String(row[colIndex["ResourceGroup"]] ?? ""),
        serviceName: String(row[colIndex["ServiceName"]] ?? ""),
        cost: Number(row[colIndex["PreTaxCost"]] ?? 0),
        currency: String(row[colIndex["Currency"]] ?? "USD"),
      });
    }

    nextLink = next ?? null;
    if (nextLink) currentUrl = nextLink;
    isFirst = false;
  } while (nextLink);

  return rows;
}

/**
 * Validate that the service principal can query Cost Management on a subscription.
 * Returns success + the subscription display name if available.
 */
export async function testCostManagementAccess(
  config: AzureCredentialConfig,
  subscriptionId: string
): Promise<{ success: boolean; subscriptionName?: string; error?: string }> {
  try {
    const token = await getAzureAccessToken(config);

    // First get the subscription display name
    const subUrl = `${ARM_BASE}/subscriptions/${subscriptionId}?api-version=2022-12-01`;
    const subRes = await axios.get<{ displayName: string }>(subUrl, {
      headers: { Authorization: `Bearer ${token}` },
    });

    // Quick cost query for yesterday to confirm Cost Management access
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    await queryCostBySubscription(config, subscriptionId, yesterday, yesterday);

    return {
      success: true,
      subscriptionName: subRes.data.displayName,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    // Try to extract a cleaner ARM error message
    if (axios.isAxiosError(err)) {
      const armError = err.response?.data?.error?.message ?? message;
      return { success: false, error: armError };
    }
    return { success: false, error: message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function toAzureDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function parseAzureDate(raw: string): string {
  // Azure returns either YYYYMMDD (integer) or YYYY-MM-DD
  if (raw.includes("-")) return raw.split("T")[0];
  if (raw.length === 8) {
    return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
  }
  return raw;
}
