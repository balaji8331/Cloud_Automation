"use client";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  CheckCircle,
  XCircle,
  Clock,
  RefreshCw,
  Wifi,
  Pencil,
  Trash2,
  Server,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { formatDate } from "@/lib/utils";

interface Subscription {
  id: string;
  subscriptionId: string;
  subscriptionName: string | null;
  isActive: boolean;
}

interface Tenant {
  id: string;
  name: string;
  azureTenantId: string;
  clientId: string;
  status: "PENDING" | "CONNECTED" | "ERROR";
  errorMessage: string | null;
  lastSyncAt: string | null;
  subscriptions: Subscription[];
}

interface TenantQueueStatus {
  busy: boolean;
  currentOperation: string | null;
  queuedCount: number;
  rateLimited: boolean;
  retryInSeconds: number | null;
}

interface TenantsTableProps {
  tenants: Tenant[];
  onEdit: (tenant: Tenant) => void;
  onDelete: (id: string) => void;
  onRefresh: () => void;
}

function operationLabel(op: string | null): string {
  if (!op) return "Working";
  const labels: Record<string, string> = {
    ingest: "Syncing costs",
    "test-connection": "Testing connection",
    "cost-query": "Querying costs",
  };
  return labels[op] ?? op;
}

export function TenantsTable({
  tenants,
  onEdit,
  onDelete,
  onRefresh,
}: TenantsTableProps) {
  const { toast } = useToast();
  const router = useRouter();
  const [loadingMap, setLoadingMap] = useState<Record<string, "test" | null>>({});
  const [queueStatus, setQueueStatus] = useState<Record<string, TenantQueueStatus>>({});
  const [activeJobs, setActiveJobs] = useState<Record<string, boolean>>({});

  const setLoading = (id: string, state: "test" | null) => {
    setLoadingMap((prev) => ({ ...prev, [id]: state }));
  };

  const fetchQueueStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/tenants/queue-status");
      if (!res.ok) return;
      const data = await res.json();
      if (data.status) setQueueStatus(data.status);
    } catch {
      // non-fatal polling error
    }
  }, []);

  const anyQueueActivity = Object.values(queueStatus).some(
    (s) => s.busy || s.rateLimited
  );
  const anyLocalLoading = Object.values(loadingMap).some(Boolean);

  useEffect(() => {
    fetchQueueStatus();
    if (!anyQueueActivity && !anyLocalLoading) return;

    const interval = setInterval(fetchQueueStatus, 2000);
    return () => clearInterval(interval);
  }, [fetchQueueStatus, anyQueueActivity, anyLocalLoading]);

  function showBusyToast(data: { error?: string }) {
    toast({
      variant: "default",
      title: "Operation already in progress",
      description: data.error ?? "Another Azure operation is running for this tenant",
    });
  }

  function queueStatusIndicator(tenantId: string) {
    const qs = queueStatus[tenantId];
    if (!qs || (!qs.busy && !qs.rateLimited)) return null;

    if (qs.rateLimited && qs.retryInSeconds != null) {
      return (
        <div className="flex items-center gap-1.5 mt-1 text-amber-700">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-[10px] font-medium">
            Rate limited — retrying in {qs.retryInSeconds}s
          </span>
        </div>
      );
    }

    if (qs.busy) {
      const label = operationLabel(qs.currentOperation);
      const queued = qs.queuedCount > 0 ? ` (${qs.queuedCount} queued)` : "";
      return (
        <div className="flex items-center gap-1.5 mt-1 text-blue-700">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span className="text-[10px] font-medium">
            {label}{queued}
          </span>
        </div>
      );
    }

    return null;
  }

  async function handleTestConnection(tenant: Tenant) {
    setLoading(tenant.id, "test");
    try {
      const res = await fetch(`/api/tenants/${tenant.id}/test-connection`, {
        method: "POST",
      });
      const data = await res.json();
      if (res.status === 409) {
        showBusyToast(data);
        return;
      }
      if (res.ok && data.success) {
        toast({ variant: "success", title: "Connection successful", description: `${tenant.name} is connected` });
      } else {
        const err = data.results?.find((r: { success: boolean; error?: string }) => !r.success)?.error
          ?? data.error
          ?? `Connection failed (HTTP ${res.status})`;
        toast({ variant: "destructive", title: "Connection failed", description: err });
      }
      onRefresh();
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Request failed" });
    } finally {
      setLoading(tenant.id, null);
      fetchQueueStatus();
    }
  }

  async function handleSyncCost(tenant: Tenant) {
    try {
      setActiveJobs(prev => ({ ...prev, [tenant.id]: true }));
      const res = await fetch(`/api/tenants/${tenant.id}/sync`, { method: "POST" });
      const data = await res.json();
      
      if (res.status === 409) {
        toast({ variant: "default", title: "Job Queued", description: "This sync is already in progress." });
        return;
      }
      
      if (res.ok) {
        toast({ variant: "default", title: "Cost Sync Complete", description: "Costs have been updated." });
        router.refresh();
      } else {
        toast({ variant: "destructive", title: "Sync failed", description: data.error ?? `HTTP ${res.status}` });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Request failed" });
    } finally {
      setActiveJobs(prev => {
        const next = { ...prev };
        delete next[tenant.id];
        return next;
      });
    }
  }

  async function handleSyncResources(tenant: Tenant) {
    try {
      setActiveJobs(prev => ({ ...prev, [tenant.id]: true }));
      const res = await fetch(`/api/resources/sync?tenantId=${tenant.id}`, { method: "POST" });
      const data = await res.json();
      
      if (res.ok) {
        toast({ variant: "default", title: "Resource Sync Complete", description: "Resources have been updated." });
        router.refresh();
      } else {
        toast({ variant: "destructive", title: "Sync failed", description: data.error ?? `HTTP ${res.status}` });
      }
    } catch {
      toast({ variant: "destructive", title: "Error", description: "Request failed" });
    } finally {
      setActiveJobs(prev => {
        const next = { ...prev };
        delete next[tenant.id];
        return next;
      });
    }
  }

  const statusBadge = (status: Tenant["status"], error?: string | null) => {
    if (status === "CONNECTED")
      return (
        <span className="flex items-center gap-1.5 text-green-700">
          <CheckCircle className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Connected</span>
        </span>
      );
    if (status === "ERROR")
      return (
        <span className="flex items-center gap-1.5 text-red-700" title={error ?? ""}>
          <XCircle className="h-3.5 w-3.5" />
          <span className="text-xs font-medium">Error</span>
        </span>
      );
    return (
      <span className="flex items-center gap-1.5 text-yellow-700">
        <Clock className="h-3.5 w-3.5" />
        <span className="text-xs font-medium">Pending</span>
      </span>
    );
  };

  if (tenants.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-gray-400">
        <p className="text-sm">No tenants configured yet.</p>
        <p className="text-xs mt-1">Add your first Azure tenant to get started.</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-200 text-left">
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Tenant</th>
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Azure Tenant ID</th>
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Subscriptions</th>
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
            <th className="pb-3 pr-4 font-medium text-gray-500 text-xs uppercase tracking-wide">Last Sync</th>
            <th className="pb-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Actions</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {tenants.map((tenant) => (
            <tr key={tenant.id} className="group">
              <td className="py-4 pr-4">
                <p className="font-medium text-gray-900">{tenant.name}</p>
                <p className="text-xs text-gray-400 font-mono mt-0.5">
                  Client: {tenant.clientId.slice(0, 8)}…
                </p>
              </td>
              <td className="py-4 pr-4">
                <code className="text-xs text-gray-600 bg-gray-100 rounded px-1.5 py-0.5">
                  {tenant.azureTenantId}
                </code>
              </td>
              <td className="py-4 pr-4">
                <div className="flex flex-wrap gap-1">
                  {tenant.subscriptions.slice(0, 3).map((s) => (
                    <Badge key={s.id} variant="outline" className="text-[10px]">
                      {s.subscriptionName ?? s.subscriptionId.slice(0, 8) + "…"}
                    </Badge>
                  ))}
                  {tenant.subscriptions.length > 3 && (
                    <Badge variant="outline" className="text-[10px]">
                      +{tenant.subscriptions.length - 3} more
                    </Badge>
                  )}
                </div>
              </td>
              <td className="py-4 pr-4">
                {statusBadge(tenant.status, tenant.errorMessage)}
                {queueStatusIndicator(tenant.id)}
                {tenant.status === "ERROR" && tenant.errorMessage && (
                  <p className="text-xs text-red-500 mt-1 max-w-[200px] truncate" title={tenant.errorMessage}>
                    {tenant.errorMessage}
                  </p>
                )}
              </td>
              <td className="py-4 pr-4 text-xs text-gray-500">
                {tenant.lastSyncAt ? formatDate(tenant.lastSyncAt) : "Never"}
              </td>
              <td className="py-4">
                <div className="flex items-center gap-1.5">
                  <Button
                    size="sm"
                    variant="outline"
                    loading={loadingMap[tenant.id] === "test"}
                    onClick={() => handleTestConnection(tenant)}
                    title="Test connection"
                  >
                    <Wifi className="h-3.5 w-3.5" />
                    Test
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={!!activeJobs[tenant.id]}
                    onClick={() => handleSyncCost(tenant)}
                    title="Sync cost data"
                    disabled={!!activeJobs[tenant.id]}
                  >
                    <RefreshCw className="h-3.5 w-3.5" />
                    Sync
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    loading={!!activeJobs[tenant.id]}
                    onClick={() => handleSyncResources(tenant)}
                    title="Sync resource inventory"
                    disabled={!!activeJobs[tenant.id]}
                  >
                    <Server className="h-3.5 w-3.5" />
                    Resources
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onEdit(tenant)}
                    aria-label="Edit tenant"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    onClick={() => onDelete(tenant.id)}
                    aria-label="Delete tenant"
                    className="text-red-500 hover:text-red-700 hover:bg-red-50"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
