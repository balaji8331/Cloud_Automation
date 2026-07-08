import {
  testCostManagementAccess,
  queryCostBySubscription,
} from "@/lib/azure/costManagement";
import {
  queryResourceGroups,
  queryResourceGraph,
} from "@/lib/azure/resourceGraph";
import { deleteAzureResource } from "@/lib/azure/deleteResource";
import type { AzureCredentialConfig } from "@/lib/azure/auth";
import type {
  CloudProviderClient,
  CloudScopeRef,
  DateRange,
  NormalizedCostRecord,
  NormalizedResourceGroup,
  NormalizedResource,
} from "../types";

export class AzureProviderClient implements CloudProviderClient {
  constructor(private config: AzureCredentialConfig) {}

  async testConnection(
    scope: CloudScopeRef
  ): Promise<{ success: boolean; scopeName?: string; error?: string }> {
    return testCostManagementAccess(this.config, scope.providerScopeId);
  }

  async queryCosts(
    scope: CloudScopeRef,
    dateRange: DateRange
  ): Promise<NormalizedCostRecord[]> {
    const raw = await queryCostBySubscription(
      this.config,
      scope.providerScopeId,
      dateRange.from,
      dateRange.to
    );
    return raw;
  }

  async listResourceGroups(
    scope: CloudScopeRef
  ): Promise<NormalizedResourceGroup[]> {
    const raw = await queryResourceGroups(this.config, [scope.providerScopeId]);
    return raw.map((rg) => ({
      id: rg.id,
      name: rg.name,
      location: rg.location,
      tags: rg.tags,
    }));
  }

  async listResources(
    scope: CloudScopeRef
  ): Promise<NormalizedResource[]> {
    // queryResourceGraph takes an array of subscriptionIds
    const { resources } = await queryResourceGraph(this.config, [
      scope.providerScopeId,
    ]);
    return resources.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type,
      location: r.location,
      resourceGroup: r.resourceGroup,
      tags: r.tags,
      provisioningState: r.provisioningState,
      sku: r.sku as Record<string, unknown> | null,
    }));
  }

  async deleteResource(resourceId: string): Promise<void> {
    // Extract resource type from ARM ID, fallback to resourcegroups
    const match = resourceId.match(/\/providers\/([^/]+\/[^/]+)/i);
    const resourceType = match ? match[1] : "microsoft.resources/resourcegroups";
    
    const result = await deleteAzureResource(
      this.config,
      resourceId,
      resourceType
    );
    if (!result.success && !result.async) {
      throw new Error(result.error ?? "Failed to delete Azure resource");
    }
  }
}
