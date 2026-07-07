/**
 * Azure ARM DELETE operations.
 *
 * REQUIRES: Contributor (or custom role with delete action) on the target subscription.
 * Cost Management Reader is NOT sufficient.
 *
 * Docs:
 *   Resource delete:       https://learn.microsoft.com/en-us/rest/api/resources/resources/delete
 *   Resource group delete: https://learn.microsoft.com/en-us/rest/api/resources/resource-groups/delete
 *   Provider API versions: https://learn.microsoft.com/en-us/rest/api/resources/providers/get
 */
import axios from "axios";
import { getAzureAccessToken, type AzureCredentialConfig } from "./auth";

const ARM_BASE = "https://management.azure.com";

export interface AzureDeleteResult {
  success: boolean;
  /** true = operation accepted (202 async), false = completed synchronously (200/204) */
  async: boolean;
  statusUrl?: string;  // Location header for async polling
  error?: string;
  /** Set when a preview API version had to be used (no stable version available) */
  usedPreviewApiVersion?: boolean;
  /** The API version actually used for the delete call */
  apiVersionUsed?: string;
}

// ─── API version cache ────────────────────────────────────────────────────────
// Key: "providerNamespace/resourceType" (lowercased)
// Value: resolved stable (or preview fallback) API version + expiry

interface CacheEntry {
  version: string;
  isPreview: boolean;
  expiresAt: number; // ms timestamp
}

const API_VERSION_CACHE = new Map<string, CacheEntry>();
const API_VERSION_TTL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Resolve the best API version for a resource type dynamically via the ARM
 * Resource Providers endpoint.  Results are cached for 1 hour per
 * (namespace + type) pair so large batches don't hammer the metadata API.
 *
 * Strategy:
 *  1. Pick the most recent STABLE (non-preview) apiVersion for the type.
 *  2. If none exists, fall back to the most recent preview version and log it.
 *  3. If the provider lookup itself fails, fall back to the hardcoded table.
 */
export async function resolveApiVersion(
  config: AzureCredentialConfig,
  subscriptionId: string,
  resourceType: string  // e.g. "Microsoft.CognitiveServices/accounts/projects"
): Promise<{ version: string; isPreview: boolean }> {
  // Parse "Provider/Type" from full resource type
  // e.g. "Microsoft.CognitiveServices/accounts/projects"
  //   → namespace = "Microsoft.CognitiveServices"
  //   → type      = "accounts/projects"
  const parts = resourceType.split("/");
  if (parts.length < 2) {
    const fallback = getHardcodedApiVersion(resourceType);
    return { version: fallback, isPreview: fallback.includes("preview") };
  }

  const namespace = parts[0];
  const typePath = parts.slice(1).join("/").toLowerCase();
  const cacheKey = `${namespace.toLowerCase()}/${typePath}`;

  // Check cache
  const cached = API_VERSION_CACHE.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return { version: cached.version, isPreview: cached.isPreview };
  }

  try {
    const token = await getAzureAccessToken(config);
    const url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/${namespace}?api-version=2021-04-01&$expand=resourceTypes`;

    const res = await axios.get<{
      resourceTypes?: Array<{ resourceType: string; apiVersions: string[] }>;
    }>(url, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: (s) => s < 500,
    });

    if (res.status !== 200 || !res.data?.resourceTypes) {
      throw new Error(`Provider lookup returned HTTP ${res.status}`);
    }

    // Find the matching resource type entry (case-insensitive).
    // For nested types like "accounts/projects", Azure returns resourceType as "accounts/projects".
    // Also try matching just the last segment in case the provider returns flat entries.
    const entry =
      res.data.resourceTypes.find((rt) => rt.resourceType.toLowerCase() === typePath) ??
      res.data.resourceTypes.find((rt) => rt.resourceType.toLowerCase() === typePath.split("/").pop());

    if (!entry || !entry.apiVersions?.length) {
      const available = res.data.resourceTypes.map((rt) => rt.resourceType).join(", ");
      throw new Error(
        `No apiVersions found for ${namespace}/${typePath}. Available types: ${available}`
      );
    }

    // Sort versions descending (newest first).
    // Azure returns them newest-first already, but sort to be safe.
    const sorted = [...entry.apiVersions].sort((a, b) => b.localeCompare(a));

    // Prefer latest stable (no "preview" in the string)
    const stable = sorted.find((v) => !v.toLowerCase().includes("preview"));
    const chosen = stable ?? sorted[0];
    const isPreview = !stable;

    const result = { version: chosen, isPreview };

    API_VERSION_CACHE.set(cacheKey, {
      ...result,
      expiresAt: Date.now() + API_VERSION_TTL_MS,
    });

    return result;
  } catch (err) {
    // Fall back to hardcoded table if the provider API fails
    const fallback = getHardcodedApiVersion(resourceType);
    const isPreview = fallback.includes("preview");
    console.warn(
      `[deleteResource] API version lookup failed for ${resourceType}, using hardcoded fallback ${fallback}: ${
        err instanceof Error ? err.message : String(err)
      }`
    );
    return { version: fallback, isPreview };
  }
}

/** Clear the in-process cache — useful between test runs */
export function clearApiVersionCache(): void {
  API_VERSION_CACHE.clear();
}

// ─── Delete operations ────────────────────────────────────────────────────────

/**
 * Delete a single Azure resource by its full ARM resource ID.
 * The api-version is resolved dynamically from the Resource Providers API
 * (with a 1-hour in-memory cache) and falls back to the hardcoded table.
 *
 * ARM DELETE is often async — returns 202 Accepted + Location header.
 * We return immediately; the caller can poll statusUrl if needed.
 */
export async function deleteAzureResource(
  config: AzureCredentialConfig,
  resourceId: string,     // full ARM ID e.g. /subscriptions/.../resourceGroups/.../providers/...
  resourceType: string,   // e.g. "Microsoft.Compute/virtualMachines"
  subscriptionId?: string // Azure subscription GUID; always parsed from resourceId as primary source
): Promise<AzureDeleteResult> {
  const token = await getAzureAccessToken(config);

  // Always prefer parsing from the ARM resource ID — it is authoritative.
  // The passed subscriptionId is only a fallback if parsing fails.
  const subId = extractSubscriptionId(resourceId) ?? subscriptionId ?? null;

  let apiVersion: string;
  let isPreview = false;

  if (subId) {
    try {
      const resolved = await resolveApiVersion(config, subId, resourceType);
      apiVersion = resolved.version;
      isPreview = resolved.isPreview;
      console.log(
        `[deleteResource] ${resourceType}: resolved API version ${apiVersion}${isPreview ? " (PREVIEW)" : ""} via provider lookup`
      );
    } catch (err) {
      // resolveApiVersion has its own internal fallback, but just in case
      apiVersion = getHardcodedApiVersion(resourceType);
      isPreview = apiVersion.includes("preview");
      console.warn(
        `[deleteResource] resolveApiVersion threw for ${resourceType}, using hardcoded ${apiVersion}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  } else {
    apiVersion = getHardcodedApiVersion(resourceType);
    isPreview = apiVersion.includes("preview");
    console.warn(
      `[deleteResource] Could not parse subscriptionId from resourceId "${resourceId}", using hardcoded API version ${apiVersion}`
    );
  }

  if (isPreview) {
    console.warn(
      `[deleteResource] ⚠️ No stable API version found for ${resourceType} — using preview version ${apiVersion}. Preview APIs may be less stable.`
    );
  }

  const url = `${ARM_BASE}${resourceId}?api-version=${apiVersion}`;

  try {
    const response = await axios.delete(url, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: (s) => s < 500,
    });

    if (response.status === 204 || response.status === 200) {
      return { success: true, async: false, apiVersionUsed: apiVersion, usedPreviewApiVersion: isPreview };
    }

    if (response.status === 202) {
      const statusUrl = response.headers["location"] ?? response.headers["azure-asyncoperation"];
      return { success: true, async: true, statusUrl, apiVersionUsed: apiVersion, usedPreviewApiVersion: isPreview };
    }

    if (response.status === 404) {
      // Already gone — treat as success
      return { success: true, async: false, apiVersionUsed: apiVersion, usedPreviewApiVersion: isPreview };
    }

    const errMsg =
      (response.data as { error?: { message?: string } })?.error?.message ??
      `HTTP ${response.status}`;
    return { success: false, async: false, error: errMsg, apiVersionUsed: apiVersion, usedPreviewApiVersion: isPreview };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (axios.isAxiosError(err)) {
      const armErr = (err.response?.data as { error?: { message?: string } })?.error?.message;
      return { success: false, async: false, error: armErr ?? message, apiVersionUsed: apiVersion, usedPreviewApiVersion: isPreview };
    }
    return { success: false, async: false, error: message, apiVersionUsed: apiVersion, usedPreviewApiVersion: isPreview };
  }
}

/**
 * Delete an entire Azure resource group and everything in it.
 * This is irreversible and will delete ALL resources in the group.
 */
export async function deleteAzureResourceGroup(
  config: AzureCredentialConfig,
  subscriptionId: string,    // raw Azure subscription GUID
  resourceGroupName: string
): Promise<AzureDeleteResult> {
  const token = await getAzureAccessToken(config);
  const url = `${ARM_BASE}/subscriptions/${subscriptionId}/resourcegroups/${resourceGroupName}?api-version=2021-04-01`;

  try {
    const response = await axios.delete(url, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: (s) => s < 500,
    });

    if (response.status === 200 || response.status === 204) {
      return { success: true, async: false };
    }

    if (response.status === 202) {
      const statusUrl = response.headers["location"] ?? response.headers["azure-asyncoperation"];
      return { success: true, async: true, statusUrl };
    }

    if (response.status === 404) {
      return { success: true, async: false };
    }

    const errMsg =
      (response.data as { error?: { message?: string } })?.error?.message ??
      `HTTP ${response.status}`;
    return { success: false, async: false, error: errMsg };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (axios.isAxiosError(err)) {
      const armErr = (err.response?.data as { error?: { message?: string } })?.error?.message;
      return { success: false, async: false, error: armErr ?? message };
    }
    return { success: false, async: false, error: message };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function extractSubscriptionId(resourceId: string): string | null {
  const m = resourceId.match(/\/subscriptions\/([^/]+)\//i);
  return m?.[1] ?? null;
}

/**
 * Hardcoded fallback API version table — used when the dynamic provider lookup
 * fails or when no subscriptionId is available.
 * Covers the most common resource types with their current stable versions.
 */
function getHardcodedApiVersion(type: string): string {
  const t = type.toLowerCase();
  if (t.startsWith("microsoft.compute/virtualmachines")) return "2023-09-01";
  if (t.startsWith("microsoft.compute/disks")) return "2023-10-02";
  if (t.startsWith("microsoft.compute/snapshots")) return "2023-10-02";
  if (t.startsWith("microsoft.compute/")) return "2023-09-01";
  if (t.startsWith("microsoft.storage/storageaccounts")) return "2023-01-01";
  if (t.startsWith("microsoft.storage/")) return "2023-01-01";
  if (t.startsWith("microsoft.network/virtualnetworks")) return "2023-09-01";
  if (t.startsWith("microsoft.network/networksecuritygroups")) return "2023-09-01";
  if (t.startsWith("microsoft.network/publicipaddresses")) return "2023-09-01";
  if (t.startsWith("microsoft.network/networkinterfaces")) return "2023-09-01";
  if (t.startsWith("microsoft.network/loadbalancers")) return "2023-09-01";
  if (t.startsWith("microsoft.network/")) return "2023-09-01";
  if (t.startsWith("microsoft.web/sites")) return "2023-01-01";
  if (t.startsWith("microsoft.web/serverfarms")) return "2023-01-01";
  if (t.startsWith("microsoft.web/")) return "2023-01-01";
  if (t.startsWith("microsoft.sql/")) return "2023-08-01-preview";
  if (t.startsWith("microsoft.containerservice/")) return "2024-01-01";
  if (t.startsWith("microsoft.keyvault/")) return "2023-07-01";
  if (t.startsWith("microsoft.insights/")) return "2023-01-01";
  if (t.startsWith("microsoft.operationalinsights/")) return "2023-09-01";
  if (t.startsWith("microsoft.eventhub/")) return "2024-01-01";
  if (t.startsWith("microsoft.servicebus/")) return "2023-01-01-preview";
  if (t.startsWith("microsoft.cognitiveservices/")) return "2024-10-01";
  if (t.startsWith("microsoft.cache/redis")) return "2023-08-01";
  if (t.startsWith("microsoft.documentdb/")) return "2023-11-15";
  if (t.startsWith("microsoft.containerregistry/")) return "2023-07-01";
  if (t.startsWith("microsoft.app/")) return "2024-03-01";
  if (t.startsWith("microsoft.logic/")) return "2019-05-01";
  if (t.startsWith("microsoft.search/")) return "2023-11-01";
  if (t.startsWith("microsoft.signalrservice/")) return "2023-08-01-preview";
  // Generic fallback
  return "2021-04-01";
}
