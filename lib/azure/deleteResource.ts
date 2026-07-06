/**
 * Azure ARM DELETE operations.
 *
 * REQUIRES: Contributor (or custom role with delete action) on the target subscription.
 * Cost Management Reader is NOT sufficient.
 *
 * Docs:
 *   Resource delete: https://learn.microsoft.com/en-us/rest/api/resources/resources/delete
 *   Resource group delete: https://learn.microsoft.com/en-us/rest/api/resources/resource-groups/delete
 */
import axios from "axios";
import { getAzureAccessToken, type AzureCredentialConfig } from "./auth";

const ARM_BASE = "https://management.azure.com";

export interface AzureDeleteResult {
  success: boolean;
  /** true = operation accepted (202 async), false = completed synchronously (200/204) */
  async: boolean;
  statusUrl?: string; // Location header for async polling
  error?: string;
}

/**
 * Delete a single Azure resource by its full ARM resource ID.
 * The api-version is inferred from the resource type.
 *
 * ARM DELETE is often async — returns 202 Accepted + Location header.
 * We return immediately; the caller can poll the statusUrl if needed.
 */
export async function deleteAzureResource(
  config: AzureCredentialConfig,
  resourceId: string,        // full ARM ID e.g. /subscriptions/.../resourceGroups/.../providers/...
  resourceType: string       // e.g. "Microsoft.Compute/virtualMachines"
): Promise<AzureDeleteResult> {
  const token = await getAzureAccessToken(config);
  const apiVersion = getApiVersionForType(resourceType);
  const url = `${ARM_BASE}${resourceId}?api-version=${apiVersion}`;

  try {
    const response = await axios.delete(url, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: (s) => s < 500, // don't throw on 4xx
    });

    if (response.status === 204 || response.status === 200) {
      return { success: true, async: false };
    }

    if (response.status === 202) {
      // Async delete accepted
      const statusUrl = response.headers["location"] ?? response.headers["azure-asyncoperation"];
      return { success: true, async: true, statusUrl };
    }

    if (response.status === 404) {
      // Already gone — treat as success
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

/**
 * Delete an entire Azure resource group and everything in it.
 * This is irreversible and will delete ALL resources in the group.
 */
export async function deleteAzureResourceGroup(
  config: AzureCredentialConfig,
  subscriptionId: string,   // raw Azure subscription GUID
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

// ─── API version map ──────────────────────────────────────────────────────────
// ARM requires a type-specific api-version for delete.
// This covers the most common resource types.

function getApiVersionForType(type: string): string {
  const t = type.toLowerCase();
  if (t.includes("microsoft.compute/virtualmachines")) return "2023-09-01";
  if (t.includes("microsoft.compute/disks")) return "2023-10-02";
  if (t.includes("microsoft.compute/snapshots")) return "2023-10-02";
  if (t.includes("microsoft.storage/storageaccounts")) return "2023-01-01";
  if (t.includes("microsoft.network/virtualnetworks")) return "2023-09-01";
  if (t.includes("microsoft.network/networksecuritygroups")) return "2023-09-01";
  if (t.includes("microsoft.network/publicipaddresses")) return "2023-09-01";
  if (t.includes("microsoft.network/networkinterfaces")) return "2023-09-01";
  if (t.includes("microsoft.network/loadbalancers")) return "2023-09-01";
  if (t.includes("microsoft.web/sites")) return "2023-01-01";
  if (t.includes("microsoft.web/serverfarms")) return "2023-01-01";
  if (t.includes("microsoft.sql/servers")) return "2022-11-01-preview";
  if (t.includes("microsoft.sql/")) return "2022-11-01-preview";
  if (t.includes("microsoft.containerservice")) return "2024-01-01";
  if (t.includes("microsoft.keyvault")) return "2023-07-01";
  if (t.includes("microsoft.insights")) return "2023-01-01";
  if (t.includes("microsoft.operationalinsights")) return "2023-09-01";
  if (t.includes("microsoft.eventhub")) return "2024-01-01";
  if (t.includes("microsoft.servicebus")) return "2022-10-01-preview";
  if (t.includes("microsoft.cognitiveservices")) return "2023-05-01";
  if (t.includes("microsoft.cache/redis")) return "2023-08-01";
  if (t.includes("microsoft.documentdb")) return "2023-11-15";
  // Generic fallback — works for most resource types
  return "2021-04-01";
}
