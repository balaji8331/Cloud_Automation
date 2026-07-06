/**
 * Azure Resource Graph API wrapper.
 * Docs: https://learn.microsoft.com/en-us/rest/api/azureresourcegraph/resources
 *
 * Falls back to ARM REST API per-subscription if Resource Graph is unavailable.
 */
import axios from "axios";
import { getAzureAccessToken, type AzureCredentialConfig } from "./auth";

const ARM_BASE = "https://management.azure.com";
const GRAPH_API_VERSION = "2022-10-01";
const ARM_API_VERSION = "2021-04-01";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AzureResource {
  id: string;           // full ARM resource ID
  name: string;
  type: string;
  location: string;
  resourceGroup: string;
  subscriptionId: string;
  tags: Record<string, string> | null;
  provisioningState: string | null;
  sku: Record<string, unknown> | null;
}

export interface AzureResourceGroup {
  id: string;
  name: string;
  location: string;
  subscriptionId: string;
  tags: Record<string, string> | null;
}

// ─── Resource Graph query ─────────────────────────────────────────────────────

/**
 * Query all resources across all subscriptions for a tenant using Resource Graph.
 * Returns flat list of resources with resource group info embedded.
 */
export async function queryResourceGraph(
  config: AzureCredentialConfig,
  subscriptionIds: string[]
): Promise<{ resources: AzureResource[]; usedFallback: boolean }> {
  try {
    const resources = await queryResourceGraphDirect(config, subscriptionIds);
    return { resources, usedFallback: false };
  } catch (err) {
    if (axios.isAxiosError(err) && (err.response?.status === 403 || err.response?.status === 401)) {
      console.warn("[ResourceGraph] No access to Resource Graph, falling back to ARM REST API");
      const resources = await queryResourcesViaARM(config, subscriptionIds);
      return { resources, usedFallback: true };
    }
    throw err;
  }
}

async function queryResourceGraphDirect(
  config: AzureCredentialConfig,
  subscriptionIds: string[]
): Promise<AzureResource[]> {
  const token = await getAzureAccessToken(config);
  const url = `${ARM_BASE}/providers/Microsoft.ResourceGraph/resources?api-version=${GRAPH_API_VERSION}`;

  const query = `Resources
| project id, name, type, location, resourceGroup, subscriptionId, tags, provisioningState = properties.provisioningState, sku
| order by type asc, name asc`;

  const resources: AzureResource[] = [];
  let skipToken: string | undefined;

  do {
    const body: Record<string, unknown> = {
      subscriptions: subscriptionIds,
      query,
      options: { resultFormat: "objectArray", top: 1000 },
    };
    if (skipToken) body.options = { ...body.options as object, skipToken };

    const res = await axios.post<{
      data: Record<string, unknown>[];
      skipToken?: string;
    }>(url, body, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });

    for (const item of res.data.data) {      resources.push(parseGraphResource(item));
    }

    skipToken = res.data.skipToken;
  } while (skipToken);

  return resources;
}

// ─── ARM fallback ─────────────────────────────────────────────────────────────

async function queryResourcesViaARM(
  config: AzureCredentialConfig,
  subscriptionIds: string[]
): Promise<AzureResource[]> {
  const token = await getAzureAccessToken(config);
  const resources: AzureResource[] = [];

  for (const subId of subscriptionIds) {
    let nextLink: string | null =
      `${ARM_BASE}/subscriptions/${subId}/resources?api-version=${ARM_API_VERSION}&$top=1000`;

    while (nextLink) {
      type ArmListResponse = { value: Record<string, unknown>[]; nextLink?: string };
      const res2: { data: ArmListResponse } = await axios.get<ArmListResponse>(nextLink, {
        headers: { Authorization: `Bearer ${token}` },
      });

      for (const item of res2.data.value) {
        const idStr = String(item.id ?? "");
        const rgMatch = idStr.match(/resourceGroups\/([^/]+)\//i);
        resources.push({
          id: idStr,
          name: String(item.name ?? ""),
          type: String(item.type ?? ""),
          location: String(item.location ?? ""),
          resourceGroup: rgMatch?.[1] ?? "",
          subscriptionId: subId,
          tags: (item.tags as Record<string, string>) ?? null,
          provisioningState:
            (item.properties as Record<string, unknown> | null)
              ?.provisioningState as string | null ?? null,
          sku: (item.sku as Record<string, unknown>) ?? null,
        });
      }

      nextLink = res2.data.nextLink ?? null;
    }

    // Small delay between subscriptions
    await new Promise((r) => setTimeout(r, 500));
  }

  return resources;
}

// ─── Resource Groups via ARM ──────────────────────────────────────────────────

export async function queryResourceGroups(
  config: AzureCredentialConfig,
  subscriptionIds: string[]
): Promise<AzureResourceGroup[]> {
  const token = await getAzureAccessToken(config);
  const groups: AzureResourceGroup[] = [];

  for (const subId of subscriptionIds) {
    let rgNextLink: string | null =
      `${ARM_BASE}/subscriptions/${subId}/resourcegroups?api-version=${ARM_API_VERSION}`;

    while (rgNextLink) {
      type ArmRGResponse = { value: Record<string, unknown>[]; nextLink?: string };
      const rgRes: { data: ArmRGResponse } = await axios.get<ArmRGResponse>(rgNextLink, {
        headers: { Authorization: `Bearer ${token}` },
      });

      for (const rg of rgRes.data.value) {
        groups.push({
          id: String(rg.id ?? ""),
          name: String(rg.name ?? ""),
          location: String(rg.location ?? ""),
          subscriptionId: subId,
          tags: (rg.tags as Record<string, string>) ?? null,
        });
      }

      rgNextLink = rgRes.data.nextLink ?? null;
    }
  }

  return groups;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function parseGraphResource(item: Record<string, unknown>): AzureResource {
  return {
    id: String(item.id ?? ""),
    name: String(item.name ?? ""),
    type: String(item.type ?? ""),
    location: String(item.location ?? ""),
    resourceGroup: String(item.resourceGroup ?? ""),
    subscriptionId: String(item.subscriptionId ?? ""),
    tags: (item.tags as Record<string, string>) ?? null,
    provisioningState: item.provisioningState as string | null ?? null,
    sku: (item.sku as Record<string, unknown>) ?? null,
  };
}
