"use client";
import { useState, useEffect, useCallback } from "react";
import {
  ChevronRight, Search, AlertTriangle, RefreshCw, Server,
  Box, MapPin, Tag, DollarSign, Trash2, Eye, EyeOff, Info,
  ShieldAlert, Layers, CheckSquare, Square, ChevronDown
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AzureDeleteDialog } from "@/components/ui/AzureDeleteDialog";
import { BulkAzureDeleteDialog } from "@/components/ui/BulkAzureDeleteDialog";
import { useToast } from "@/components/ui/toast";
import { useSession } from "next-auth/react";
import { useTenants } from "@/lib/context/TenantsContext";
import { formatCurrency } from "@/lib/utils";

interface Subscription { id: string; subscriptionId: string; subscriptionName: string | null; isActive: boolean; }
interface ResourceGroup {
  id: string; name: string; location: string | null;
  tenantId: string; tenantName: string;
  subscriptionId: string; subscriptionName: string;
  resourceCount: number; typeBreakdown: Record<string, number>;
  mtdCost: number; lastSyncedAt: string | null; isActive: boolean;
}
interface Resource {
  id: string; resourceId: string; name: string; type: string;
  location: string | null; provisioningState: string | null;
  tags: Record<string, string> | null;
  tenantName: string; subscriptionName: string; resourceGroupName: string;
  mtdCost: number; isActive: boolean; manuallyRemoved: boolean; lastSyncedAt: string | null;
}
interface BreadcrumbState {
  tenantId?: string; tenantName?: string;
  subscriptionId?: string; subscriptionName?: string;
  resourceGroupId?: string; resourceGroupName?: string;
}

function shortType(t: string) { return t.split("/").pop() ?? t; }
function statusVariant(s: string | null): "success" | "danger" | "warning" | "outline" {
  if (!s) return "outline";
  if (s.toLowerCase() === "succeeded") return "success";
  if (s.toLowerCase() === "failed") return "danger";
  return "warning";
}

export default function ResourcesPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const isAdmin = session?.user?.role === "ADMIN" || session?.user?.role === "SUPER_ADMIN";
  const { tenants } = useTenants();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [groups, setGroups] = useState<ResourceGroup[]>([]);
  const [resources, setResources] = useState<Resource[]>([]);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState<string | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const [crumb, setCrumb] = useState<BreadcrumbState>({});
  const [search, setSearch] = useState("");
  const [filterType, setFilterType] = useState("all");
  const [orphanedOnly, setOrphanedOnly] = useState(false);
  const [showRemoved, setShowRemoved] = useState(false);

  // Selection state
  const [selectedRGs, setSelectedRGs] = useState<Set<string>>(new Set());
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set());

  // Azure delete dialog
  const [azureDeleteTarget, setAzureDeleteTarget] = useState<{
    id: string; name: string; type: "resource" | "resource group"; detail?: string;
  } | null>(null);

  const [bulkAzureDeleteTarget, setBulkAzureDeleteTarget] = useState<{
    type: "resource" | "resource_group"; count: number;
  } | null>(null);

  // Level: tenants → subscriptions → groups → resources
  const level = crumb.resourceGroupId ? "resources"
    : crumb.subscriptionId ? "groups"
    : crumb.tenantId ? "subscriptions"
    : "tenants";

  // ── Fetch subscriptions when tenant selected ──────────────────────────────
  useEffect(() => {
    if (!crumb.tenantId) { setSubscriptions([]); return; }
    fetch(`/api/tenants/${crumb.tenantId}`)
      .then((r) => r.json())
      .then((d) => setSubscriptions(d.subscriptions ?? []))
      .catch(console.error);
  }, [crumb.tenantId]);

  // ── Fetch groups ──────────────────────────────────────────────────────────
  const fetchGroups = useCallback(async () => {
    if (!crumb.subscriptionId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (crumb.tenantId) params.set("tenantId", crumb.tenantId);
      params.set("subscriptionId", crumb.subscriptionId);
      if (showRemoved) params.set("showRemoved", "true");
      const res = await fetch(`/api/resources/groups?${params}`);
      const data = await res.json();
      setGroups(Array.isArray(data) ? data : []);
      setSelectedRGs(new Set());
    } finally { setLoading(false); }
  }, [crumb.tenantId, crumb.subscriptionId, showRemoved]);

  // ── Fetch resources ───────────────────────────────────────────────────────
  const fetchResources = useCallback(async () => {
    if (!crumb.resourceGroupId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (crumb.tenantId) params.set("tenantId", crumb.tenantId);
      if (crumb.subscriptionId) params.set("subscriptionId", crumb.subscriptionId);
      params.set("resourceGroupId", crumb.resourceGroupId);
      if (search) params.set("search", search);
      if (filterType !== "all") params.set("type", filterType);
      if (orphanedOnly) params.set("orphaned", "true");
      if (showRemoved) params.set("showRemoved", "true");
      const res = await fetch(`/api/resources?${params}`);
      const data = await res.json();
      setResources(Array.isArray(data) ? data : []);
      setSelectedResources(new Set());
    } finally { setLoading(false); }
  }, [crumb, search, filterType, orphanedOnly, showRemoved]);

  useEffect(() => { if (level === "groups") fetchGroups(); }, [level, fetchGroups]);
  useEffect(() => { if (level === "resources") fetchResources(); }, [level, fetchResources]);

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleSync(tenantId: string) {
    setSyncing(tenantId);
    try {
      const res = await fetch(`/api/resources/sync?tenantId=${tenantId}`, { method: "POST" });
      const data = await res.json();
      if (data.success) {
        toast({ variant: "success", title: "Sync complete", description: `${data.resourcesUpserted} resources` });
        if (level === "groups") fetchGroups();
        if (level === "resources") fetchResources();
      } else {
        toast({ variant: "destructive", title: "Sync failed", description: data.error });
      }
    } catch { toast({ variant: "destructive", title: "Error" }); }
    finally { setSyncing(null); }
  }

  async function handleRemoveResource(resource: Resource) {
    if (!confirm(`Remove "${resource.name}" from portal?\nNext sync restores it if still in Azure.`)) return;
    setRemoving(resource.id);
    try {
      const res = await fetch(`/api/resources/${resource.id}/remove`, { method: "POST" });
      const data = await res.json();
      if (data.success) { toast({ variant: "success", title: "Removed" }); fetchResources(); }
      else toast({ variant: "destructive", title: "Failed", description: data.error });
    } catch { toast({ variant: "destructive", title: "Error" }); }
    finally { setRemoving(null); }
  }

  async function handleRemoveGroup(group: ResourceGroup) {
    if (!confirm(`Remove "${group.name}" from portal?\nNext sync restores it if still in Azure.`)) return;
    setRemoving(group.id);
    try {
      const res = await fetch(`/api/resources/groups/${group.id}/remove`, { method: "POST" });
      const data = await res.json();
      if (data.success) { toast({ variant: "success", title: "Removed" }); fetchGroups(); }
      else toast({ variant: "destructive", title: "Failed", description: data.error });
    } catch { toast({ variant: "destructive", title: "Error" }); }
    finally { setRemoving(null); }
  }

  // Bulk portal-only remove
  async function handleBulkRemove(targetType: "resource" | "resource_group") {
    const ids = targetType === "resource_group"
      ? Array.from(selectedRGs)
      : Array.from(selectedResources);
    if (!ids.length) return;
    const label = targetType === "resource_group" ? `${ids.length} resource group(s)` : `${ids.length} resource(s)`;
    if (!confirm(`Remove ${label} from portal inventory?\nNext sync restores them if still in Azure.`)) return;
    setBulkDeleting(true);
    try {
      const res = await fetch("/api/resources/bulk-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids, targetType }),
      });
      const data = await res.json();
      if (data.success) {
        toast({ variant: "success", title: `Removed ${data.removed} item(s) from inventory` });
        if (targetType === "resource_group") { setSelectedRGs(new Set()); fetchGroups(); }
        else { setSelectedResources(new Set()); fetchResources(); }
      } else {
        toast({ variant: "destructive", title: "Bulk remove failed", description: data.error });
      }
    } catch { toast({ variant: "destructive", title: "Error" }); }
    finally { setBulkDeleting(false); }
  }

  async function executeAzureDelete() {
    if (!azureDeleteTarget) return;
    const { id, type, name } = azureDeleteTarget;
    const endpoint = type === "resource group"
      ? `/api/resources/groups/${id}/azure-delete`
      : `/api/resources/${id}/azure-delete`;
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirmName: name }),
    });
    const data = await res.json();

    // Handle nested-resource conflicts (409)
    if (res.status === 409 && data.nestedChildren) {
      const childList = data.nestedChildren.map((c: { name: string }) => c.name).join(", ");
      throw new Error(
        `${data.error} ${childList}. Delete child resources first, then retry.`
      );
    }

    if (!res.ok) throw new Error(data.error ?? "Delete failed");
    toast({ variant: "success", title: data.async ? "Delete in progress" : "Deleted from Azure", description: data.message });
    if (type === "resource group") fetchGroups();
    else fetchResources();
  }

  async function executeBulkAzureDelete(confirmPhrase: string) {
    if (!bulkAzureDeleteTarget) return;
    const { type } = bulkAzureDeleteTarget;
    const ids = type === "resource_group" ? Array.from(selectedRGs) : Array.from(selectedResources);
    
    const res = await fetch("/api/resources/bulk-azure-delete", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids, targetType: type, confirmPhrase }),
    });
    
    const data = await res.json();
    
    if (data.success) {
      const failed = data.total - data.deleted;
      if (failed > 0) {
        toast({ 
          variant: "destructive", 
          title: `Partial success (${data.deleted}/${data.total} deleted)`, 
          description: `Some deletions failed — likely due to nested resources. Check Azure Portal for details.` 
        });
      } else {
        toast({ variant: "success", title: "Bulk delete initiated", description: `Successfully submitted ${data.deleted} deletions to Azure.` });
      }
      
      if (type === "resource_group") {
        setSelectedRGs(new Set());
        fetchGroups();
      } else {
        setSelectedResources(new Set());
        fetchResources();
      }
    } else {
      throw new Error(data.error || "Bulk delete failed.");
    }
  }

  // ── Selection helpers ─────────────────────────────────────────────────────

  function toggleRG(id: string) {
    setSelectedRGs((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllRGs() {
    setSelectedRGs(selectedRGs.size === groups.length ? new Set() : new Set(groups.map((g) => g.id)));
  }
  function toggleResource(id: string) {
    setSelectedResources((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }
  function toggleAllResources() {
    setSelectedResources(selectedResources.size === resources.length ? new Set() : new Set(resources.map((r) => r.id)));
  }

  const uniqueTypes = Array.from(new Set(resources.map((r) => r.type))).sort();

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">

      {/* Breadcrumb */}
      <nav className="flex items-center flex-wrap gap-1.5 text-sm" aria-label="Breadcrumb">
        <button onClick={() => setCrumb({})}
          className={`hover:text-blue-600 ${level === "tenants" ? "text-gray-900 font-medium" : "text-gray-500"}`}>
          All Tenants
        </button>
        {crumb.tenantName && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
            <button
              onClick={() => setCrumb({ tenantId: crumb.tenantId, tenantName: crumb.tenantName })}
              className={`hover:text-blue-600 ${level === "subscriptions" ? "text-gray-900 font-medium" : "text-gray-500"}`}>
              {crumb.tenantName}
            </button>
          </>
        )}
        {crumb.subscriptionName && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
            <button
              onClick={() => setCrumb({ tenantId: crumb.tenantId, tenantName: crumb.tenantName, subscriptionId: crumb.subscriptionId, subscriptionName: crumb.subscriptionName })}
              className={`hover:text-blue-600 ${level === "groups" ? "text-gray-900 font-medium" : "text-gray-500"}`}>
              {crumb.subscriptionName}
            </button>
          </>
        )}
        {crumb.resourceGroupName && (
          <>
            <ChevronRight className="h-3.5 w-3.5 text-gray-400" />
            <span className="text-gray-900 font-medium">{crumb.resourceGroupName}</span>
          </>
        )}
      </nav>

      {/* Show-removed banner */}
      {showRemoved && (
        <div className="flex items-start gap-2 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-800">
          <Info className="h-4 w-4 mt-0.5 shrink-0" />
          Showing manually removed items. They <strong className="mx-1">reappear on next sync</strong> if still in Azure.
        </div>
      )}

      {/* ── Level: Tenants ── */}
      {level === "tenants" && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tenants.length === 0 && (
            <p className="text-sm text-gray-400 col-span-3">No tenants configured.</p>
          )}
          {tenants.map((t) => (
            <Card key={t.id} className="cursor-pointer hover:border-blue-300 hover:shadow-md transition-all"
              onClick={() => setCrumb({ tenantId: t.id, tenantName: t.name })}>
              <CardContent className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-blue-100">
                    <Server className="h-5 w-5 text-blue-600" />
                  </div>
                  <div>
                    <p className="font-medium text-gray-900">{t.name}</p>
                    <p className="text-xs text-gray-400 mt-0.5">Click to browse subscriptions</p>
                  </div>
                </div>
                {isAdmin && (
                  <Button size="sm" variant="outline" loading={syncing === t.id}
                    onClick={(e) => { e.stopPropagation(); handleSync(t.id); }}>
                    <RefreshCw className="h-3.5 w-3.5" /> Sync
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* ── Level: Subscriptions ── */}
      {level === "subscriptions" && (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-gray-500">{subscriptions.filter((s) => s.isActive).length} subscriptions in {crumb.tenantName}</p>
            {isAdmin && crumb.tenantId && (
              <Button size="sm" variant="outline" loading={syncing === crumb.tenantId}
                onClick={() => handleSync(crumb.tenantId!)}>
                <RefreshCw className="h-3.5 w-3.5" /> Sync Resources
              </Button>
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {subscriptions.filter((s) => s.isActive).map((sub) => (
              <Card key={sub.id}
                className="cursor-pointer hover:border-blue-300 hover:shadow-md transition-all"
                onClick={() => setCrumb({
                  tenantId: crumb.tenantId, tenantName: crumb.tenantName,
                  subscriptionId: sub.id,
                  subscriptionName: sub.subscriptionName ?? sub.subscriptionId,
                })}>
                <CardContent className="flex items-center gap-3 p-5">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-purple-100 shrink-0">
                    <Layers className="h-4 w-4 text-purple-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">
                      {sub.subscriptionName ?? "Unnamed subscription"}
                    </p>
                    <p className="text-[11px] text-gray-400 font-mono mt-0.5 truncate">
                      {sub.subscriptionId}
                    </p>
                  </div>
                  <ChevronDown className="h-4 w-4 text-gray-400 shrink-0 -rotate-90 ml-auto" />
                </CardContent>
              </Card>
            ))}
            {subscriptions.filter((s) => s.isActive).length === 0 && (
              <p className="text-sm text-gray-400 col-span-3">No subscriptions found for this tenant.</p>
            )}
          </div>
        </>
      )}

      {/* ── Level: Resource Groups ── */}
      {level === "groups" && (
        <>
          {/* Toolbar */}
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <p className="text-sm text-gray-500">{groups.length} resource groups</p>
              {selectedRGs.size > 0 && isAdmin && (
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-blue-700 bg-blue-50 rounded px-2 py-1">
                    {selectedRGs.size} selected
                  </span>
                  <Button size="sm" variant="outline"
                    className="text-gray-600 border-gray-300"
                    loading={bulkDeleting}
                    onClick={() => handleBulkRemove("resource_group")}>
                    <Trash2 className="h-3.5 w-3.5" /> Remove selected from portal
                  </Button>
                  <Button size="sm" variant="destructive"
                    className="bg-red-600 hover:bg-red-700"
                    disabled={bulkDeleting}
                    onClick={() => setBulkAzureDeleteTarget({ type: "resource_group", count: selectedRGs.size })}>
                    <ShieldAlert className="h-3.5 w-3.5" /> Delete selected from Azure
                  </Button>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm" variant={showRemoved ? "default" : "outline"} onClick={() => setShowRemoved((v) => !v)}>
                {showRemoved ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                {showRemoved ? "Hide removed" : "Show removed"}
              </Button>
              {isAdmin && crumb.tenantId && (
                <Button size="sm" variant="outline" loading={syncing === crumb.tenantId}
                  onClick={() => handleSync(crumb.tenantId!)}>
                  <RefreshCw className="h-3.5 w-3.5" /> Sync
                </Button>
              )}
            </div>
          </div>

          {/* Select-all row */}
          {isAdmin && groups.length > 0 && !showRemoved && (
            <div className="flex items-center gap-2 px-1">
              <button onClick={toggleAllRGs} className="flex items-center gap-2 text-xs text-gray-500 hover:text-gray-700">
                {selectedRGs.size === groups.length && groups.length > 0
                  ? <CheckSquare className="h-4 w-4 text-blue-600" />
                  : <Square className="h-4 w-4" />}
                {selectedRGs.size === groups.length && groups.length > 0 ? "Deselect all" : "Select all"}
              </button>
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
          ) : groups.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">
              No resource groups found. Run a resource sync first.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {groups.map((g) => (
                <div key={g.id} className={`relative rounded-xl border bg-white shadow-sm transition-all
                  ${selectedRGs.has(g.id) ? "border-blue-400 ring-1 ring-blue-400" : "border-gray-200"}
                  ${!g.isActive ? "opacity-60 border-dashed" : "hover:border-blue-200 hover:shadow-md"}`}>

                  {/* Checkbox */}
                  {isAdmin && !showRemoved && (
                    <button
                      onClick={() => toggleRG(g.id)}
                      className="absolute top-3 left-3 z-10 p-0.5"
                      aria-label="Select resource group">
                      {selectedRGs.has(g.id)
                        ? <CheckSquare className="h-4 w-4 text-blue-600" />
                        : <Square className="h-4 w-4 text-gray-300 hover:text-gray-500" />}
                    </button>
                  )}

                  {/* Card content — clickable to drill down */}
                  <div className={`cursor-pointer ${isAdmin && !showRemoved ? "pl-9" : ""}`}
                    onClick={() => setCrumb({
                      tenantId: crumb.tenantId, tenantName: crumb.tenantName,
                      subscriptionId: crumb.subscriptionId, subscriptionName: crumb.subscriptionName,
                      resourceGroupId: g.id, resourceGroupName: g.name,
                    })}>
                    <div className="px-4 pt-3 pb-1">
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <p className="font-medium text-sm text-gray-900">{g.name}</p>
                          {!g.isActive && <Badge variant="warning" className="text-[10px]">removed</Badge>}
                        </div>
                        <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                          {g.mtdCost > 0 && (
                            <span className="text-xs font-medium text-blue-700 bg-blue-50 rounded px-2 py-0.5">
                              {formatCurrency(g.mtdCost, "USD", true)} MTD
                            </span>
                          )}
                          {isAdmin && g.isActive && (
                            <>
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-gray-400 hover:text-gray-600"
                                loading={removing === g.id} onClick={() => handleRemoveGroup(g)}
                                title="Remove from portal only">
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                              <Button size="icon" variant="ghost" className="h-6 w-6 text-red-500 hover:text-red-700 hover:bg-red-50"
                                onClick={() => setAzureDeleteTarget({ id: g.id, name: g.name, type: "resource group",
                                  detail: `Contains ${g.resourceCount} resource(s). All permanently destroyed.` })}
                                title="Delete from Azure permanently">
                                <ShieldAlert className="h-3.5 w-3.5" />
                              </Button>
                            </>
                          )}
                        </div>
                      </div>
                      <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                        <MapPin className="h-3 w-3" />{g.location ?? "—"}
                      </p>
                    </div>
                    <div className="px-4 pb-3">
                      <div className="flex flex-wrap gap-1.5">
                        <Badge variant="outline" className="text-[10px]">{g.resourceCount} resources</Badge>
                        {Object.entries(g.typeBreakdown).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, count]) => (
                          <Badge key={type} variant="default" className="text-[10px]">{count}× {shortType(type)}</Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {/* ── Level: Resources ── */}
      {level === "resources" && (
        <>
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-48">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
              <input type="text" value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, type, location…"
                className="h-9 w-full rounded-md border border-gray-300 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <Select value={filterType} onValueChange={setFilterType}>
              <SelectTrigger className="w-44"><SelectValue placeholder="All types" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All types</SelectItem>
                {uniqueTypes.map((t) => <SelectItem key={t} value={t}>{shortType(t)}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button size="sm" variant={orphanedOnly ? "default" : "outline"} onClick={() => setOrphanedOnly((v) => !v)}>
              <AlertTriangle className="h-3.5 w-3.5" /> Orphaned
            </Button>
            <Button size="sm" variant={showRemoved ? "default" : "outline"} onClick={() => setShowRemoved((v) => !v)}>
              {showRemoved ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
              {showRemoved ? "Hide removed" : "Show removed"}
            </Button>
          </div>

          {/* Bulk action bar */}
          {isAdmin && !showRemoved && (
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div className="flex items-center gap-3">
                {selectedResources.size > 0 ? (
                  <>
                    <span className="text-xs font-medium text-blue-700 bg-blue-50 rounded px-2 py-1">
                      {selectedResources.size} selected
                    </span>
                    <Button size="sm" variant="outline" className="text-gray-600"
                      loading={bulkDeleting} onClick={() => handleBulkRemove("resource")}>
                      <Trash2 className="h-3.5 w-3.5" /> Remove selected from portal
                    </Button>
                    <Button size="sm" variant="destructive"
                      className="bg-red-600 hover:bg-red-700"
                      disabled={bulkDeleting}
                      onClick={() => setBulkAzureDeleteTarget({ type: "resource", count: selectedResources.size })}>
                      <ShieldAlert className="h-3.5 w-3.5" /> Delete selected from Azure
                    </Button>
                  </>
                ) : (
                  <p className="text-xs text-gray-400">
                    <Trash2 className="h-3.5 w-3.5 inline mr-1 text-gray-400" />= portal only
                    <ShieldAlert className="h-3.5 w-3.5 inline mx-1 text-red-400 ml-3" />= delete from Azure
                  </p>
                )}
              </div>
            </div>
          )}

          {loading ? (
            <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
          ) : (
            <Card>
              <CardContent className="p-0">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 bg-gray-50 text-left">
                        {isAdmin && !showRemoved && (
                          <th className="px-3 py-3 w-8">
                            <button onClick={toggleAllResources} aria-label="Select all">
                              {selectedResources.size === resources.length && resources.length > 0
                                ? <CheckSquare className="h-4 w-4 text-blue-600" />
                                : <Square className="h-4 w-4 text-gray-400" />}
                            </button>
                          </th>
                        )}
                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Name</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Type</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Location</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Status</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">MTD Cost</th>
                        <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Tags</th>
                        {isAdmin && !showRemoved && (
                          <th className="px-4 py-3 font-medium text-gray-500 text-xs uppercase tracking-wide">Actions</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {resources.length === 0 && (
                        <tr><td colSpan={8} className="px-4 py-12 text-center text-gray-400 text-sm">
                          {showRemoved ? "No removed resources." : "No resources found."}
                        </td></tr>
                      )}
                      {resources.map((r) => {
                        const isOrphaned = r.mtdCost === 0 && !showRemoved;
                        const isSelected = selectedResources.has(r.id);
                        return (
                          <tr key={r.id} className={
                            isSelected ? "bg-blue-50/60" :
                            r.manuallyRemoved ? "bg-red-50/30 opacity-60" :
                            isOrphaned ? "bg-yellow-50/40" : ""}>
                            {isAdmin && !showRemoved && (
                              <td className="px-3 py-3">
                                <button onClick={() => toggleResource(r.id)} aria-label="Select resource">
                                  {isSelected
                                    ? <CheckSquare className="h-4 w-4 text-blue-600" />
                                    : <Square className="h-4 w-4 text-gray-300 hover:text-gray-500" />}
                                </button>
                              </td>
                            )}
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-2">
                                <Box className="h-3.5 w-3.5 text-gray-400 shrink-0" />
                                <div>
                                  <p className="font-medium text-gray-900 max-w-[180px] truncate" title={r.name}>{r.name}</p>
                                  {r.manuallyRemoved && (
                                    <span className="text-[10px] text-red-600 flex items-center gap-0.5">
                                      <Trash2 className="h-3 w-3" /> removed
                                    </span>
                                  )}
                                  {isOrphaned && !r.manuallyRemoved && (
                                    <span className="text-[10px] text-yellow-700 flex items-center gap-0.5">
                                      <AlertTriangle className="h-3 w-3" /> possibly orphaned
                                    </span>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="px-4 py-3">
                              <code className="text-xs text-gray-500 bg-gray-100 rounded px-1.5 py-0.5">{shortType(r.type)}</code>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">{r.location ?? "—"}</td>
                            <td className="px-4 py-3">
                              <Badge variant={statusVariant(r.provisioningState)}>{r.provisioningState ?? "Unknown"}</Badge>
                            </td>
                            <td className="px-4 py-3">
                              {r.mtdCost > 0
                                ? <span className="flex items-center gap-1 text-xs font-medium text-blue-700">
                                    <DollarSign className="h-3 w-3" />{formatCurrency(r.mtdCost, "USD", true)}
                                  </span>
                                : <span className="text-xs text-gray-400">—</span>}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex flex-wrap gap-1">
                                {r.tags && Object.entries(r.tags).slice(0, 2).map(([k, v]) => (
                                  <span key={k} className="flex items-center gap-0.5 text-[10px] bg-gray-100 rounded px-1.5 py-0.5 text-gray-600">
                                    <Tag className="h-2.5 w-2.5" />{k}: {v}
                                  </span>
                                ))}
                                {r.tags && Object.keys(r.tags).length > 2 && (
                                  <span className="text-[10px] text-gray-400">+{Object.keys(r.tags).length - 2}</span>
                                )}
                              </div>
                            </td>
                            {isAdmin && !showRemoved && (
                              <td className="px-4 py-3">
                                <div className="flex items-center gap-1">
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-gray-400 hover:text-gray-600"
                                    loading={removing === r.id} onClick={() => handleRemoveResource(r)}
                                    title="Remove from portal only">
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </Button>
                                  <Button size="icon" variant="ghost" className="h-7 w-7 text-red-500 hover:text-red-700 hover:bg-red-50"
                                    onClick={() => setAzureDeleteTarget({ id: r.id, name: r.name, type: "resource",
                                      detail: `Type: ${r.type} • Location: ${r.location ?? "unknown"}` })}
                                    title="Delete from Azure permanently">
                                    <ShieldAlert className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Azure delete dialog */}
      {azureDeleteTarget && (
        <AzureDeleteDialog
          open={!!azureDeleteTarget}
          onClose={() => setAzureDeleteTarget(null)}
          onConfirm={executeAzureDelete}
          resourceName={azureDeleteTarget.name}
          resourceType={azureDeleteTarget.type}
          detail={azureDeleteTarget.detail}
        />
      )}

      {bulkAzureDeleteTarget && (
        <BulkAzureDeleteDialog
          open={!!bulkAzureDeleteTarget}
          onClose={() => setBulkAzureDeleteTarget(null)}
          onConfirm={executeBulkAzureDelete}
          count={bulkAzureDeleteTarget.count}
          resourceType={bulkAzureDeleteTarget.type}
        />
      )}
    </div>
  );
}
