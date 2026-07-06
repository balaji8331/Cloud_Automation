"use client";
import { useState, useEffect, useCallback } from "react";
import { Plus, ExternalLink, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BudgetFormDialog } from "./BudgetFormDialog";
import { useToast } from "@/components/ui/toast";
import { useSession } from "next-auth/react";
import { useTenants } from "@/lib/context/TenantsContext";
import { formatCurrency, formatDate } from "@/lib/utils";
import { cn } from "@/lib/utils";

interface BudgetRow {
  id: string; name: string; amount: number; timeGrain: string;
  startDate: string; endDate: string | null; alertThreshold: number;
  currentSpend: number; spendPercent: number; tenantId: string;
  subscriptionId: string | null; scopeType: string; scopeId: string | null;
  source: string; azurePortalUrl: string | null;
}

function progressColor(pct: number) {
  if (pct >= 100) return "bg-red-500";
  if (pct >= 80) return "bg-yellow-500";
  return "bg-green-500";
}

function scopeLabel(b: BudgetRow, tenantName: string) {
  if (b.scopeType === "TENANT") return tenantName;
  if (b.scopeType === "SUBSCRIPTION") return `${tenantName} → Sub`;
  if (b.scopeType === "RESOURCE_GROUP") return `${tenantName} → ${b.scopeId ?? "RG"}`;
  return tenantName;
}

export default function BudgetsPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const { tenants } = useTenants();
  const isAdmin = session?.user?.role === "ADMIN";

  const [budgets, setBudgets] = useState<BudgetRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingBudget, setEditingBudget] = useState<BudgetRow | null>(null);
  const [scopeFilter, setScopeFilter] = useState("all");
  const [tenantFilter, setTenantFilter] = useState("all");

  const fetchBudgets = useCallback(async () => {
    setLoading(true);
    try {
      const bRes = await fetch("/api/budgets");
      setBudgets(await bRes.json());
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchBudgets(); }, [fetchBudgets]);

  async function handleDelete(id: string) {
    if (!confirm("Delete this budget?")) return;
    const res = await fetch(`/api/budgets/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ variant: "success", title: "Budget deleted" }); fetchBudgets(); }
    else toast({ variant: "destructive", title: "Delete failed" });
  }

  async function handleSyncAzureBudgets() {
    setSyncing(true);
    try {
      const res = await fetch("/api/jobs/ingest", { method: "POST" });
      const data = await res.json();
      if (data.hasFailures) {
        const failed = (data.tenants as { tenant: string; status: string; error?: string }[])
          ?.filter((t) => t.status === "failed")
          .map((t) => `${t.tenant}: ${t.error ?? "unknown"}`)
          .join("; ");
        toast({
          variant: "destructive",
          title: "Ingest completed with failures",
          description: failed || "One or more tenants failed to sync",
        });
      } else if (res.ok) {
        toast({ variant: "success", title: "Azure budget sync complete" });
      } else {
        toast({ variant: "destructive", title: "Sync failed", description: data.error ?? `HTTP ${res.status}` });
      }
    } catch { toast({ variant: "destructive", title: "Error" }); }
    finally { setSyncing(false); }
  }

  const tenantNames = Object.fromEntries(tenants.map((t) => [t.id, t.name]));
  const overBudget = budgets.filter((b) => b.spendPercent >= 100).length;
  const nearBudget = budgets.filter((b) => b.spendPercent >= 80 && b.spendPercent < 100).length;

  const filtered = budgets.filter((b) => {
    if (tenantFilter !== "all" && b.tenantId !== tenantFilter) return false;
    if (scopeFilter !== "all" && b.scopeType !== scopeFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex gap-4 text-sm">
          {overBudget > 0 && <span className="text-red-600 font-medium">⚠️ {overBudget} over budget</span>}
          {nearBudget > 0 && <span className="text-yellow-600 font-medium">⚠️ {nearBudget} near threshold</span>}
        </div>
        <div className="flex items-center gap-2">
          {isAdmin && (
            <Button variant="outline" size="sm" onClick={handleSyncAzureBudgets} loading={syncing}>
              <RefreshCw className="h-4 w-4" /> Sync Azure Budgets
            </Button>
          )}
          {isAdmin && (
            <Button onClick={() => { setEditingBudget(null); setDialogOpen(true); }}>
              <Plus className="h-4 w-4" /> Add Budget
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3">
        <Select value={tenantFilter} onValueChange={setTenantFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All tenants" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All tenants</SelectItem>
            {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={scopeFilter} onValueChange={setScopeFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="All scopes" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All scopes</SelectItem>
            <SelectItem value="TENANT">Tenant</SelectItem>
            <SelectItem value="SUBSCRIPTION">Subscription</SelectItem>
            <SelectItem value="RESOURCE_GROUP">Resource Group</SelectItem>
          </SelectContent>
        </Select>
        <span className="text-sm text-gray-500 ml-1">{filtered.length} budgets</span>
      </div>

      {/* Budget Cards */}
      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">No budgets configured.</div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {filtered.map((b) => {
            const pct = Math.min(b.spendPercent, 100);
            const tName = tenantNames[b.tenantId] ?? b.tenantId.slice(0, 8);
            const isAzure = b.source === "AZURE_NATIVE";
            return (
              <Card key={b.id} className={cn("relative", b.spendPercent >= 100 && "border-red-200", b.spendPercent >= 80 && b.spendPercent < 100 && "border-yellow-200")}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <CardTitle className="text-sm leading-snug">{b.name}</CardTitle>
                      <p className="text-[11px] text-gray-400 mt-0.5">{scopeLabel(b, tName)}</p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant={isAzure ? "default" : "outline"} className="text-[10px]">
                        {isAzure ? "Azure" : "Portal"}
                      </Badge>
                      <Badge variant="outline" className="text-[10px]">
                        {b.scopeType.replace("_", " ")}
                      </Badge>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {/* Spend bar */}
                  <div>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className={cn("font-medium",
                        b.spendPercent >= 100 ? "text-red-600" :
                        b.spendPercent >= 80 ? "text-yellow-600" : "text-green-600")}>
                        {formatCurrency(b.currentSpend)} / {formatCurrency(b.amount)}
                      </span>
                      <span className="text-gray-500">{b.spendPercent.toFixed(1)}%</span>
                    </div>
                    <Progress value={pct} className="h-1.5" indicatorClassName={progressColor(b.spendPercent)} />
                  </div>

                  {/* Meta */}
                  <div className="flex items-center justify-between text-[11px] text-gray-400">
                    <span>{b.timeGrain} • Alert at {(Number(b.alertThreshold) * 100).toFixed(0)}%</span>
                    <span>{formatDate(b.startDate)}</span>
                  </div>

                  {/* Actions */}
                  {isAdmin && (
                    <div className="flex items-center gap-2 pt-1">
                      {isAzure ? (
                        <a href={b.azurePortalUrl ?? "#"} target="_blank" rel="noopener noreferrer"
                          className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                          <ExternalLink className="h-3 w-3" /> Manage in Azure
                        </a>
                      ) : (
                        <>
                          <Button size="sm" variant="outline" className="h-7 text-xs"
                            onClick={() => { setEditingBudget(b); setDialogOpen(true); }}>Edit</Button>
                          <Button size="sm" variant="ghost"
                            className="h-7 text-xs text-red-500 hover:bg-red-50"
                            onClick={() => handleDelete(b.id)}>Delete</Button>
                        </>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {isAdmin && (
        <BudgetFormDialog
          open={dialogOpen}
          budget={editingBudget}
          tenants={tenants}
          onClose={() => setDialogOpen(false)}
          onSaved={() => { setDialogOpen(false); fetchBudgets(); }}
        />
      )}
    </div>
  );
}
