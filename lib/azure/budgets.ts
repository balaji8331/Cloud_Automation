/**
 * Azure Budgets API wrapper — pulls budgets at subscription + RG scope.
 * Docs: https://learn.microsoft.com/en-us/rest/api/consumption/budgets
 */
import axios from "axios";
import { getAzureAccessToken, type AzureCredentialConfig } from "./auth";

const ARM_BASE = "https://management.azure.com";
const API_VERSION = "2023-05-01";

export interface AzureBudget {
  id: string;          // full ARM resource ID
  name: string;
  amount: number;
  timeGrain: string;
  startDate: string;
  endDate?: string;
  currentSpend?: number;
  currency?: string;
  scope: "subscription" | "resource_group";
  subscriptionId: string;
  resourceGroupName?: string;
  azurePortalUrl: string;
}

interface ArmBudgetValue {
  id: string;
  name: string;
  properties: {
    amount: number;
    timeGrain: string;
    timePeriod: { startDate: string; endDate?: string };
    currentSpend?: { amount: number; unit: string };
    notifications?: Record<string, unknown>;
  };
}

interface ArmBudgetList { value: ArmBudgetValue[]; }

async function fetchBudgetsAtScope(
  token: string,
  scope: string,  // ARM scope path
  subscriptionId: string,
  resourceGroupName?: string
): Promise<AzureBudget[]> {
  const url = `${ARM_BASE}${scope}/providers/Microsoft.Consumption/budgets?api-version=${API_VERSION}`;
  try {
    const res = await axios.get<ArmBudgetList>(url, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: (s) => s < 500,
    });
    if (res.status === 404 || res.status === 403) return [];

    return (res.data.value ?? []).map((b) => ({
      id: b.id,
      name: b.name,
      amount: b.properties.amount,
      timeGrain: b.properties.timeGrain,
      startDate: b.properties.timePeriod.startDate,
      endDate: b.properties.timePeriod.endDate,
      currentSpend: b.properties.currentSpend?.amount,
      currency: b.properties.currentSpend?.unit,
      scope: resourceGroupName ? "resource_group" : "subscription",
      subscriptionId,
      resourceGroupName,
      azurePortalUrl: `https://portal.azure.com/#view/Microsoft_Azure_CostManagement/BudgetDetailsBladeV2/id/${encodeURIComponent(b.id)}`,
    }));
  } catch {
    return [];
  }
}

/** List all budgets at subscription scope */
export async function listSubscriptionBudgets(
  config: AzureCredentialConfig,
  subscriptionId: string
): Promise<AzureBudget[]> {
  const token = await getAzureAccessToken(config);
  return fetchBudgetsAtScope(token, `/subscriptions/${subscriptionId}`, subscriptionId);
}

/** List all budgets at resource group scope */
export async function listResourceGroupBudgets(
  config: AzureCredentialConfig,
  subscriptionId: string,
  resourceGroupName: string
): Promise<AzureBudget[]> {
  const token = await getAzureAccessToken(config);
  return fetchBudgetsAtScope(
    token,
    `/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}`,
    subscriptionId,
    resourceGroupName
  );
}

/** Pull all Azure-native budgets for a tenant across all subscriptions */
export async function syncAllAzureBudgets(
  config: AzureCredentialConfig,
  subscriptions: { subscriptionId: string; subscriptionName?: string | null }[]
): Promise<AzureBudget[]> {
  const token = await getAzureAccessToken(config);
  const all: AzureBudget[] = [];

  for (const sub of subscriptions) {
    // Subscription-level budgets
    const subBudgets = await fetchBudgetsAtScope(
      token, `/subscriptions/${sub.subscriptionId}`, sub.subscriptionId
    );
    all.push(...subBudgets);

    // Delay to avoid rate limiting
    await new Promise((r) => setTimeout(r, 300));
  }

  return all;
}

/** Check if SP has write permission (needed for deletion schedules) */
export async function checkContributorAccess(
  config: AzureCredentialConfig,
  subscriptionId: string
): Promise<{ hasAccess: boolean; role?: string; error?: string }> {
  const token = await getAzureAccessToken(config);
  // Try a harmless write-test: read role assignments for the SP
  const url = `${ARM_BASE}/subscriptions/${subscriptionId}/providers/Microsoft.Authorization/roleAssignments?api-version=2022-04-01&$filter=assignedTo('${config.clientId}')`;
  try {
    const res = await axios.get<{ value: { properties: { roleDefinitionId: string } }[] }>(url, {
      headers: { Authorization: `Bearer ${token}` },
      validateStatus: (s) => s < 500,
    });
    if (res.status !== 200) return { hasAccess: false, error: `HTTP ${res.status}` };

    const roleIds = res.data.value.map((r) => r.properties.roleDefinitionId);
    const contributorId = "b24988ac-6180-42a0-ab88-20f7382dd24c";
    const ownerId = "8e3af657-a8ff-443c-a75c-2fe8c4bcb635";
    const hasContributor = roleIds.some((id) =>
      id.endsWith(contributorId) || id.endsWith(ownerId)
    );
    return {
      hasAccess: hasContributor,
      role: hasContributor ? "Contributor" : "Reader/Cost Management Reader",
    };
  } catch (err) {
    return { hasAccess: false, error: err instanceof Error ? err.message : "Unknown" };
  }
}
