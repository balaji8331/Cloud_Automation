"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Plus, Play, Trash2, CheckCircle,
  AlertTriangle, Shield, Eye
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { useSession } from "next-auth/react";
import { useTenants } from "@/lib/context/TenantsContext";
import { ScheduleFormDialog } from "./ScheduleFormDialog";
import { RunHistoryPanel } from "./RunHistoryPanel";
import { formatDate } from "@/lib/utils";
import cronstrue from "cronstrue";

interface AutomationSchedule {
  id: string; name: string; tenantId: string; tenant: { name: string };
  scopeType: string; targetIds: string[];
  cronExpression: string; isEnabled: boolean; liveDeletesApproved: boolean;
  excludeTagKey: string; notifyBeforeMinutes: number; notifyEmails: string;
  createdAt: string; createdBy: { email: string };
  runs: { status: string; startedAt: string; plannedResources: unknown[] | null; deletedResources: unknown[] | null }[];
}

// For the form dialog (subset of full schedule)
type ScheduleFormInput = {
  id: string; tenantId: string; name: string; scopeType: string;
  targetIds: string[]; cronExpression: string; excludeTagKey: string;
  notifyBeforeMinutes: number; notifyEmails: string;
};

function humanCron(expr: string): string {
  try { return cronstrue.toString(expr); }
  catch { return expr; }
}

function lastRunBadge(runs: AutomationSchedule["runs"]) {
  const last = runs[0];
  if (!last) return <Badge variant="outline" className="text-[10px]">No runs yet</Badge>;
  const v: Record<string, "success" | "danger" | "warning" | "outline" | "default"> = {
    COMPLETED: "success", FAILED: "danger", DRY_RUN: "warning",
    EXECUTING: "default", CANCELLED: "outline", NOTIFIED: "warning",
  };
  return <Badge variant={v[last.status] ?? "outline"} className="text-[10px]">{last.status}</Badge>;
}

export default function AutomationPage() {
  const { data: session } = useSession();
  const { toast } = useToast();
  const isAdmin = session?.user?.role === "ADMIN";
  const { tenants } = useTenants();

  const [schedules, setSchedules] = useState<AutomationSchedule[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editingSchedule, setEditingSchedule] = useState<ScheduleFormInput | null>(null);
  const [historyScheduleId, setHistoryScheduleId] = useState<string | null>(null);
  const [permChecks, setPermChecks] = useState<Record<string, boolean>>({});
  const [runningId, setRunningId] = useState<string | null>(null);

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/automation/schedules");
      const data = await res.json();
      setSchedules(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  // Check contributor permissions per unique tenant
  useEffect(() => {
    const uniqueTenantIds = [...new Set(schedules.map((s) => s.tenantId))];
    uniqueTenantIds.forEach(async (tid) => {
      if (permChecks[tid] !== undefined) return;
      try {
        const res = await fetch(`/api/automation/check-permissions?tenantId=${tid}`);
        const data = await res.json();
        setPermChecks((prev) => ({ ...prev, [tid]: data.hasAccess ?? false }));
      } catch { setPermChecks((prev) => ({ ...prev, [tid]: false })); }
    });
  }, [schedules, permChecks]);

  async function handleToggle(s: AutomationSchedule) {
    await fetch(`/api/automation/schedules/${s.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isEnabled: !s.isEnabled }),
    });
    fetchSchedules();
  }

  async function handleDelete(id: string) {
    if (!confirm("Delete this schedule? All run history will be lost.")) return;
    await fetch(`/api/automation/schedules/${id}`, { method: "DELETE" });
    toast({ variant: "success", title: "Schedule deleted" });
    fetchSchedules();
  }

  async function handleApprove(s: AutomationSchedule) {
    if (!confirm(`Approve live deletions for "${s.name}"?\n\nThis will allow real Azure resources to be deleted on schedule. This is irreversible until you disable the schedule.`)) return;
    const res = await fetch(`/api/automation/schedules/${s.id}/approve`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      toast({ variant: "success", title: "Live deletions approved", description: data.message });
      fetchSchedules();
    } else {
      toast({ variant: "destructive", title: "Cannot approve", description: data.error });
    }
  }

  async function handleRunNow(s: AutomationSchedule) {
    setRunningId(s.id);
    try {
      const res = await fetch(`/api/automation/schedules/${s.id}/run`, { method: "POST" });
      const data = await res.json();
      toast({ variant: "success", title: "Run triggered", description: data.message });
      setTimeout(fetchSchedules, 3000);
    } catch { toast({ variant: "destructive", title: "Error" }); }
    finally { setRunningId(null); }
  }

  if (!isAdmin) {
    return <div className="py-20 text-center text-gray-400">Automation is Admin-only.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-gray-500">Schedule automated resource cleanup. All new schedules run a dry-run first.</p>
        </div>
        <Button onClick={() => { setEditingSchedule(null); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> Create Schedule
        </Button>
      </div>

      {/* Dry-run safety notice */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Shield className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <p className="font-semibold">Safety: Dry-run first, always</p>
          <p className="mt-0.5">Every new schedule's first run is a <strong>dry run</strong> — it emails the resource list but deletes nothing. An Admin must explicitly click <strong>Approve Live Deletions</strong> before actual deletes occur.</p>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center text-gray-400 text-sm">Loading…</div>
      ) : schedules.length === 0 ? (
        <div className="py-16 text-center text-gray-400 text-sm">No deletion schedules configured.</div>
      ) : (
        <div className="space-y-4">
          {schedules.map((s) => {
            const hasPerm = permChecks[s.tenantId];
            const lastRun = s.runs[0];
            const resourceCount = (lastRun?.plannedResources as unknown[])?.length ?? 0;

            return (
              <Card key={s.id} className={s.isEnabled ? "" : "opacity-60"}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-sm">{s.name}</CardTitle>
                        {lastRunBadge(s.runs)}
                        {s.liveDeletesApproved
                          ? <Badge variant="danger" className="text-[10px]">Live Deletes ON</Badge>
                          : <Badge variant="warning" className="text-[10px]">Dry Run Only</Badge>}
                        {!s.isEnabled && <Badge variant="outline" className="text-[10px]">Disabled</Badge>}
                      </div>
                      <p className="text-xs text-gray-500">
                        {s.tenant.name} • {s.scopeType.replace("_", " ")} • {(s.targetIds as string[]).join(", ")}
                      </p>
                      <p className="text-xs text-gray-400">
                        🕐 {humanCron(s.cronExpression)} UTC
                        {resourceCount > 0 && <span className="ml-2">• Last: {resourceCount} resources</span>}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap">
                      {/* Contributor warning */}
                      {hasPerm === false && (
                        <span className="flex items-center gap-1 text-[11px] text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-1">
                          <AlertTriangle className="h-3 w-3" /> Needs Contributor role
                        </span>
                      )}

                      {/* Approve live deletes */}
                      {!s.liveDeletesApproved && (
                        <Button size="sm" variant="outline"
                          className="border-green-300 text-green-700 hover:bg-green-50"
                          onClick={() => handleApprove(s)}>
                          <CheckCircle className="h-3.5 w-3.5" /> Approve Live
                        </Button>
                      )}

                      <Button size="sm" variant="outline" loading={runningId === s.id}
                        onClick={() => handleRunNow(s)} title="Run now">
                        <Play className="h-3.5 w-3.5" /> Run Now
                      </Button>

                      <Button size="sm" variant="outline" onClick={() => setHistoryScheduleId(s.id)}>
                        <Eye className="h-3.5 w-3.5" /> History
                      </Button>

                      <Button size="sm" variant={s.isEnabled ? "secondary" : "default"}
                        onClick={() => handleToggle(s)}>
                        {s.isEnabled ? "Disable" : "Enable"}
                      </Button>

                      <Button size="sm" variant="outline"
                        onClick={() => { setEditingSchedule({
                          id: s.id, tenantId: s.tenantId, name: s.name,
                          scopeType: s.scopeType, targetIds: s.targetIds as string[],
                          cronExpression: s.cronExpression, excludeTagKey: s.excludeTagKey,
                          notifyBeforeMinutes: s.notifyBeforeMinutes, notifyEmails: s.notifyEmails ?? "",
                        }); setCreateOpen(true); }}>
                        Edit
                      </Button>

                      <Button size="icon" variant="ghost"
                        className="h-8 w-8 text-red-500 hover:bg-red-50"
                        onClick={() => handleDelete(s.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-0">
                  <div className="flex flex-wrap gap-3 text-[11px] text-gray-400">
                    <span>Exclude tag: <code className="bg-gray-100 rounded px-1">{s.excludeTagKey}</code></span>
                    <span>Notify {s.notifyBeforeMinutes}min before</span>
                    <span>Created by {s.createdBy.email} on {formatDate(s.createdAt)}</span>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      <ScheduleFormDialog
        open={createOpen}
        schedule={editingSchedule}
        tenants={tenants}
        onClose={() => setCreateOpen(false)}
        onSaved={() => { setCreateOpen(false); fetchSchedules(); }}
      />

      {historyScheduleId && (
        <RunHistoryPanel
          scheduleId={historyScheduleId}
          onClose={() => setHistoryScheduleId(null)}
        />
      )}
    </div>
  );
}
