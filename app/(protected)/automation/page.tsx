"use client";
import { useState, useEffect, useCallback } from "react";
import {
  Plus, Play, Trash2, CheckCircle,
  AlertTriangle, Shield, Eye, Clock, Loader2
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

interface LastRun {
  id: string;
  status: string;
  startedAt: string;
  plannedResources: unknown[] | null;
  deletedResources: unknown[] | null;
  scheduledExecutionAt: string | null;
  notifiedAt: string | null;
}

interface AutomationSchedule {
  id: string; name: string; tenantId: string; tenant: { name: string };
  scopeType: string; targetIds: string[];
  cronExpression: string; isEnabled: boolean;
  approvalStatus: "PENDING_DRY_RUN" | "AWAITING_APPROVAL" | "APPROVED" | "DISABLED";
  excludeTagKey: string; notifyBeforeMinutes: number; notifyEmails: string;
  createdAt: string; createdBy: { email: string };
  runs: LastRun[];
}

type ScheduleFormInput = {
  id: string; tenantId: string; name: string; scopeType: string;
  targetIds: string[]; cronExpression: string; excludeTagKey: string;
  notifyBeforeMinutes: number; notifyEmails: string;
};

function humanCron(expr: string): string {
  try {
    // Parse the UTC cron and convert to IST for display
    const firstLine = expr.split("\n")[0];
    const parts = firstLine.split(" ");
    const utcMinute = Number(parts[0] ?? "0");
    const utcHour = Number(parts[1]?.split(",")[0] ?? "0");
    // IST = UTC + 5:30
    const IST_OFFSET = 5 * 60 + 30;
    const totalUTC = utcHour * 60 + utcMinute;
    const totalIST = (totalUTC + IST_OFFSET) % (24 * 60);
    const istHour = Math.floor(totalIST / 60);
    const istMin = totalIST % 60;
    const h12 = istHour % 12 || 12;
    const ampm = istHour < 12 ? "AM" : "PM";
    const minStr = String(istMin).padStart(2, "0");
    return `At ${h12}:${minStr} ${ampm} IST`;
  } catch { return expr; }
}

function approvalBadge(s: AutomationSchedule) {
  if (!s.isEnabled) {
    return <Badge variant="outline" className="text-[10px]">Disabled</Badge>;
  }
  switch (s.approvalStatus) {
    case "PENDING_DRY_RUN":
      return <Badge variant="warning" className="text-[10px] flex items-center gap-1">
        <Loader2 className="h-2.5 w-2.5 animate-spin" /> Dry run pending…
      </Badge>;
    case "AWAITING_APPROVAL":
      return <Badge variant="warning" className="text-[10px]">⏳ Awaiting approval (check email)</Badge>;
    case "APPROVED":
      return <Badge variant="danger" className="text-[10px]">🔴 Live — running automatically</Badge>;
    case "DISABLED":
      return <Badge variant="outline" className="text-[10px]">Disabled</Badge>;
    default:
      return null;
  }
}

function lifecycleStatus(s: AutomationSchedule): React.ReactNode {
  const lastRun = s.runs[0];

  if (!s.isEnabled || s.approvalStatus === "DISABLED") {
    return <span className="text-gray-400">Schedule disabled</span>;
  }

  if (s.approvalStatus === "PENDING_DRY_RUN") {
    return <span className="text-amber-600">Dry run will trigger automatically within 60s</span>;
  }

  if (s.approvalStatus === "AWAITING_APPROVAL") {
    const dryRunTime = lastRun?.startedAt
      ? `Dry run completed ${formatDate(lastRun.startedAt)}`
      : "Dry run completed";
    return <span className="text-amber-600">{dryRunTime} — approval email sent, waiting for admin click</span>;
  }

  if (s.approvalStatus === "APPROVED") {
    // Check if there's a NOTIFIED run upcoming
    const notifiedRun = s.runs.find((r) => r.status === "NOTIFIED");
    if (notifiedRun?.scheduledExecutionAt) {
      const execTime = new Date(notifiedRun.scheduledExecutionAt);
      const now = new Date();
      const diffMin = Math.round((execTime.getTime() - now.getTime()) / 60000);
      if (diffMin > 0) {
        return <span className="text-orange-600 font-medium">
          ⚠️ Deletion in {diffMin}min ({execTime.toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} IST)
          {" — "}<a href={`/api/automation/cancel?runId=${notifiedRun.id}`} className="underline text-red-600">Cancel</a>
        </span>;
      }
    }
    return <span className="text-green-700">
      ✓ Approved — next run: <strong>{humanCron(s.cronExpression)}</strong> UTC
    </span>;
  }

  return null;
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
  const [runningNow, setRunningNow] = useState<Set<string>>(new Set());

  const fetchSchedules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/automation/schedules");
      const data = await res.json();
      setSchedules(Array.isArray(data) ? data : []);
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchSchedules(); }, [fetchSchedules]);

  // Auto-refresh every 30s to show lifecycle progress
  useEffect(() => {
    const interval = setInterval(fetchSchedules, 30_000);
    return () => clearInterval(interval);
  }, [fetchSchedules]);

  // Refresh immediately when user returns to this tab (e.g. after clicking approve in email)
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") {
        fetchSchedules();
      }
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [fetchSchedules]);

  // Check contributor permissions
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

  async function handleApproveFromUI(s: AutomationSchedule) {
    if (!confirm(`Approve live deletions for "${s.name}"?\n\nThis will allow real Azure resources to be deleted on schedule.`)) return;
    const res = await fetch(`/api/automation/schedules/${s.id}/approve`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      toast({ variant: "success", title: "Approved", description: data.message });
      fetchSchedules();
    } else {
      toast({ variant: "destructive", title: "Cannot approve", description: data.error });
    }
  }

  async function handleRunNow(s: AutomationSchedule) {
    setRunningNow((prev) => new Set(prev).add(s.id));
    try {
      const res = await fetch(`/api/automation/schedules/${s.id}/run`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Run failed to start", description: data.error ?? data.message });
        return;
      }
      toast({
        variant: "default",
        title: "Run started",
        description: s.approvalStatus === "APPROVED"
          ? "Executing live deletion now. Check history for progress."
          : "Dry run started. You'll receive an email with results shortly.",
      });
      setTimeout(() => fetchSchedules(), 3000);
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setRunningNow((prev) => { const n = new Set(prev); n.delete(s.id); return n; });
    }
  }

  if (!isAdmin) {
    return <div className="py-20 text-center text-gray-400">Automation is Admin-only.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">
          Scheduled resource cleanup — fully automatic after one-time approval.
        </p>
        <Button onClick={() => { setEditingSchedule(null); setCreateOpen(true); }}>
          <Plus className="h-4 w-4" /> Create Schedule
        </Button>
      </div>

      {/* Lifecycle explanation */}
      <div className="flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3">
        <Shield className="h-5 w-5 text-blue-600 mt-0.5 shrink-0" />
        <div className="text-sm text-blue-800">
          <p className="font-semibold">Fully automatic after approval</p>
          <p className="mt-0.5">
            1. Create schedule → dry run triggers automatically → approval email sent.<br />
            2. Click <strong>Approve</strong> in the email (one time only).<br />
            3. Schedule runs automatically — notification email sent before each run with a Cancel option.
          </p>
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
              <Card key={s.id} className={!s.isEnabled ? "opacity-60" : ""}>
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between flex-wrap gap-3">
                    <div className="space-y-1 flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-sm">{s.name}</CardTitle>
                        {approvalBadge(s)}
                      </div>
                      <p className="text-xs text-gray-500">
                        {s.tenant.name} • {s.scopeType.replace(/_/g, " ")} •{" "}
                        {(s.targetIds as string[]).join(", ")}
                      </p>
                      <p className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {humanCron(s.cronExpression)} UTC
                        {resourceCount > 0 && <span className="ml-2">• Last: {resourceCount} resources</span>}
                      </p>
                      {/* Lifecycle status line */}
                      <p className="text-xs mt-0.5">
                        {lifecycleStatus(s)}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 flex-wrap justify-end">
                      {/* UI Approve button — only shown when awaiting approval */}
                      {s.approvalStatus === "AWAITING_APPROVAL" && (
                        <Button size="sm" variant="outline"
                          className="border-green-300 text-green-700 hover:bg-green-50"
                          onClick={() => handleApproveFromUI(s)}>
                          <CheckCircle className="h-3.5 w-3.5" /> Approve
                        </Button>
                      )}

                      {/* Run Now — manual override, clearly labeled */}
                      <Button size="sm" variant="outline"
                        loading={runningNow.has(s.id)}
                        disabled={runningNow.has(s.id) || !s.isEnabled}
                        onClick={() => handleRunNow(s)}
                        title="Manual override — triggers dry run or live run immediately">
                        <Play className="h-3.5 w-3.5" />
                        {s.approvalStatus === "APPROVED" ? "Run Now" : "Dry Run Now"}
                      </Button>

                      <Button size="sm" variant="outline" onClick={() => setHistoryScheduleId(s.id)}>
                        <Eye className="h-3.5 w-3.5" /> History
                      </Button>

                      <Button size="sm" variant={s.isEnabled ? "secondary" : "default"}
                        onClick={() => handleToggle(s)}>
                        {s.isEnabled ? "Disable" : "Enable"}
                      </Button>

                      <Button size="sm" variant="outline"
                        onClick={() => {
                          setEditingSchedule({
                            id: s.id, tenantId: s.tenantId, name: s.name,
                            scopeType: s.scopeType, targetIds: s.targetIds as string[],
                            cronExpression: s.cronExpression, excludeTagKey: s.excludeTagKey,
                            notifyBeforeMinutes: s.notifyBeforeMinutes, notifyEmails: s.notifyEmails ?? "",
                          });
                          setCreateOpen(true);
                        }}>
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
                  <div className="flex flex-wrap gap-3 text-[11px] text-gray-400 items-center">
                    <span>Exclude tag: <code className="bg-gray-100 rounded px-1">{s.excludeTagKey}</code></span>
                    <span>Notify {s.notifyBeforeMinutes}min before</span>
                    <span>Created by {s.createdBy.email} on {formatDate(s.createdAt)}</span>
                    {hasPerm === false && (
                      <span className="flex items-center gap-1 text-orange-700 bg-orange-50 border border-orange-200 rounded px-2 py-0.5 ml-auto">
                        <AlertTriangle className="h-3 w-3" /> Needs Contributor role
                      </span>
                    )}
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
