"use client";
import { useSearchParams, useRouter } from "next/navigation";
import { useCallback } from "react";

export interface ScopeState {
  tenantId: string | null;
  subscriptionId: string | null;
  resourceGroup: string | null;
}

export function useScopeParams() {
  const searchParams = useSearchParams();
  const router = useRouter();

  const tenantId = searchParams.get("tenantId");
  const subscriptionId = searchParams.get("subscriptionId");
  const resourceGroup = searchParams.get("resourceGroup");

  const setScope = useCallback((scope: Partial<ScopeState>) => {
    const params = new URLSearchParams(searchParams.toString());
    
    if (scope.tenantId !== undefined) {
      if (scope.tenantId) params.set("tenantId", scope.tenantId);
      else params.delete("tenantId");
    }
    if (scope.subscriptionId !== undefined) {
      if (scope.subscriptionId) params.set("subscriptionId", scope.subscriptionId);
      else params.delete("subscriptionId");
    }
    if (scope.resourceGroup !== undefined) {
      if (scope.resourceGroup) params.set("resourceGroup", scope.resourceGroup);
      else params.delete("resourceGroup");
    }

    router.replace(`?${params.toString()}`);
  }, [searchParams, router]);

  const resetScope = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("tenantId");
    params.delete("subscriptionId");
    params.delete("resourceGroup");
    router.replace(`?${params.toString()}`);
  }, [searchParams, router]);

  return {
    scope: { tenantId, subscriptionId, resourceGroup },
    setScope,
    resetScope
  };
}
