"use client";
import { useState, useEffect } from "react";
import { useTenants } from "@/lib/context/TenantsContext";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fetchWithAuth } from "@/lib/auth/fetchWithAuth";
import { useScopeParams } from "@/hooks/useScopeParams";
import type { DateRange } from "@/lib/utils";

interface Subscription {
  id: string;
  subscriptionId: string;
  subscriptionName: string | null;
}

interface ScopeSelectorProps {
  range: DateRange;
  customFrom?: string;
  customTo?: string;
}

export function ScopeSelector({ range, customFrom, customTo }: ScopeSelectorProps) {
  const { tenants, loading: tenantsLoading } = useTenants();
  const { scope, setScope } = useScopeParams();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [subsLoading, setSubsLoading] = useState(false);

  const [resourceGroups, setResourceGroups] = useState<string[]>([]);
  const [rgsLoading, setRgsLoading] = useState(false);

  // Fetch subscriptions when tenantId is selected
  useEffect(() => {
    if (!scope.tenantId) {
      setSubscriptions([]);
      return;
    }
    const fetchSubs = async () => {
      setSubsLoading(true);
      try {
        const res = await fetchWithAuth(`/api/dashboard/scope/subscriptions?tenantId=${scope.tenantId}`);
        const data = await res.json();
        if (Array.isArray(data)) setSubscriptions(data);
      } catch (err) {
        console.error("Failed to fetch subscriptions", err);
      } finally {
        setSubsLoading(false);
      }
    };
    fetchSubs();
  }, [scope.tenantId]);

  // Fetch Resource Groups when subscriptionId is selected
  useEffect(() => {
    if (!scope.subscriptionId) {
      setResourceGroups([]);
      return;
    }
    const fetchRgs = async () => {
      setRgsLoading(true);
      try {
        const params = new URLSearchParams({ range });
        if (scope.subscriptionId) params.set("subscriptionId", scope.subscriptionId);
        if (range === "custom" && customFrom && customTo) {
          params.set("from", customFrom);
          params.set("to", customTo);
        }
        const res = await fetchWithAuth(`/api/dashboard/scope/resource-groups?${params.toString()}`);
        const data = await res.json();
        if (Array.isArray(data)) setResourceGroups(data);
      } catch (err) {
        console.error("Failed to fetch resource groups", err);
      } finally {
        setRgsLoading(false);
      }
    };
    fetchRgs();
  }, [scope.subscriptionId, range, customFrom, customTo]);

  const Spinner = () => (
    <svg className="h-3 w-3 animate-spin ml-2 inline" viewBox="0 0 24 24" fill="none">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );

  return (
    <div className="flex flex-wrap gap-3 items-end">
      <div className="flex flex-col gap-1">
        <label className="text-xs text-gray-500">
          Tenant {tenantsLoading && <Spinner />}
        </label>
        <Select 
          value={scope.tenantId ?? "all"} 
          onValueChange={(val) => {
            if (val === "all") {
              setScope({ tenantId: null, subscriptionId: null, resourceGroup: null });
            } else {
              setScope({ tenantId: val, subscriptionId: null, resourceGroup: null });
            }
          }}
          disabled={tenantsLoading}
        >
          <SelectTrigger className="w-48">
            <SelectValue placeholder="All Tenants" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Tenants</SelectItem>
            {tenants.map(t => (
              <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {scope.tenantId && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">
            Subscription {subsLoading && <Spinner />}
          </label>
          <Select 
            value={scope.subscriptionId ?? "all"} 
            onValueChange={(val) => {
              if (val === "all") {
                setScope({ subscriptionId: null, resourceGroup: null });
              } else {
                setScope({ subscriptionId: val, resourceGroup: null });
              }
            }}
            disabled={subsLoading}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Subscriptions" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Subscriptions</SelectItem>
              {subscriptions.map(s => (
                <SelectItem key={s.id} value={s.id}>{s.subscriptionName ?? s.subscriptionId}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {scope.subscriptionId && (
        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-500">
            Resource Group {rgsLoading && <Spinner />}
          </label>
          <Select 
            value={scope.resourceGroup ?? "all"} 
            onValueChange={(val) => {
              if (val === "all") {
                setScope({ resourceGroup: null });
              } else {
                setScope({ resourceGroup: val });
              }
            }}
            disabled={rgsLoading}
          >
            <SelectTrigger className="w-48">
              <SelectValue placeholder="All Resource Groups" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Resource Groups</SelectItem>
              {resourceGroups.map(rg => (
                <SelectItem key={rg} value={rg}>{rg}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
