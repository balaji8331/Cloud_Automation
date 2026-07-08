/**
 * Shared types and interfaces for the Cloud Provider abstraction layer.
 * All providers (Azure, AWS, GCP) must implement this shape.
 */

export interface DateRange {
  from: Date;
  to: Date;
}

export interface CloudScopeRef {
  providerScopeId: string;
}

export interface NormalizedCostRecord {
  date: string;         // YYYY-MM-DD
  resourceGroup: string;
  serviceName: string;  // Meter category / service name
  cost: number;
  currency: string;
}

export interface NormalizedResourceGroup {
  id: string;
  name: string;
  location: string;
  tags: Record<string, string> | null;
}

export interface NormalizedResource {
  id: string;
  name: string;
  type: string;
  location: string;
  resourceGroup: string;
  tags: Record<string, string> | null;
  provisioningState: string | null;
  sku: Record<string, unknown> | null;
}

export interface CloudProviderClient {
  /** Test connection and basic read permissions for the scope */
  testConnection(scope: CloudScopeRef): Promise<{ success: boolean; scopeName?: string; error?: string }>;
  
  /** Query raw daily costs */
  queryCosts(scope: CloudScopeRef, dateRange: DateRange): Promise<NormalizedCostRecord[]>;
  
  /** List all resource groups / logical containers */
  listResourceGroups(scope: CloudScopeRef): Promise<NormalizedResourceGroup[]>;
  
  /** List all individual resources */
  listResources(scope: CloudScopeRef): Promise<NormalizedResource[]>;
  
  /** Delete a specific resource (group or individual) by its fully qualified ID */
  deleteResource(resourceId: string): Promise<void>;
}
