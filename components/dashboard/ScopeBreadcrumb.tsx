"use client";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useScopeParams } from "@/hooks/useScopeParams";
import { useTenants } from "@/lib/context/TenantsContext";
import { useEffect, useState } from "react";
import { fetchWithAuth } from "@/lib/auth/fetchWithAuth";

interface ScopeBreadcrumbProps {
  tenantName?: string;
}

export function ScopeBreadcrumb({ tenantName }: ScopeBreadcrumbProps) {
  const { scope, resetScope } = useScopeParams();
  const { tenants } = useTenants();
  
  const [subName, setSubName] = useState<string | null>(null);

  useEffect(() => {
    if (!scope.subscriptionId || !scope.tenantId) {
      setSubName(null);
      return;
    }
    // Fetch the subscription name if we don't have it locally (since it's not in a global context)
    // To avoid an extra network call just for the name, we can hit the subscriptions endpoint and find it
    const fetchSubName = async () => {
      try {
        const res = await fetchWithAuth(`/api/dashboard/scope/subscriptions?tenantId=${scope.tenantId}`);
        const data = await res.json();
        const sub = data.find((s: any) => s.id === scope.subscriptionId);
        if (sub) {
          setSubName(sub.subscriptionName ?? sub.subscriptionId);
        }
      } catch (err) {
        console.error("Failed to fetch sub name for breadcrumb");
      }
    };
    fetchSubName();
  }, [scope.tenantId, scope.subscriptionId]);

  if (!scope.tenantId) {
    return (
      <div className="text-sm text-gray-500 flex items-center">
        Showing: <span className="font-medium text-gray-900 ml-1">All Tenants (combined)</span>
      </div>
    );
  }

  const tName = tenants.find(t => t.id === scope.tenantId)?.name ?? "Unknown Tenant";

  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 bg-gray-50 border px-3 py-1.5 rounded-md w-fit">
      <span>Showing:</span>
      <div className="flex items-center font-medium text-gray-900">
        <span>{tName}</span>
        {scope.subscriptionId && (
          <>
            <span className="mx-2 text-gray-400">→</span>
            <span>{subName || "..."}</span>
          </>
        )}
        {scope.resourceGroup && (
          <>
            <span className="mx-2 text-gray-400">→</span>
            <span>{scope.resourceGroup}</span>
          </>
        )}
      </div>
      <Button 
        variant="ghost" 
        size="icon" 
        className="h-5 w-5 ml-2 hover:bg-gray-200 rounded-full" 
        onClick={resetScope}
        title="Reset to All Tenants"
      >
        <X className="h-3 w-3" />
      </Button>
    </div>
  );
}
