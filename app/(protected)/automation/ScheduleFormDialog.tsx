"use client";
import { useState, useEffect } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
  DialogFooter, DialogDescription
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { Plus, X } from "lucide-react";

interface Tenant { id: string; name: string; }
interface DeletionScheduleInput {
  id: string; tenantId: string; name: string; scopeType: string;
  targetIds: string[]; cronExpression: string; excludeTagKey: string;
  notifyBeforeMinutes: number; notifyEmails: string;
}
interface Subscription { id: string; subscriptionId: string; subscriptionName: string | null; }
interface ResourceGroup { id: string; name: string; subscriptionName: string; }

// A "run time" entry — hour + minute pair (always in IST for the UI)
interface RunTime { hour: string; minute: string; }

// IST is UTC+5:30
const IST_OFFSET_MINUTES = 5 * 60 + 30;

/** Convert IST hour+minute to UTC hour+minute, handling day wrap. */
function istToUtc(hour: number, minute: number): { hour: number; minute: number } {
  const totalMinutesIST = hour * 60 + minute;
  let totalMinutesUTC = totalMinutesIST - IST_OFFSET_MINUTES;
  // Wrap around midnight
  totalMinutesUTC = ((totalMinutesUTC % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    hour: Math.floor(totalMinutesUTC / 60),
    minute: totalMinutesUTC % 60,
  };
}

/** Convert UTC hour+minute to IST hour+minute. */
function utcToIst(hour: number, minute: number): { hour: number; minute: number } {
  const totalMinutesUTC = hour * 60 + minute;
  let totalMinutesIST = totalMinutesUTC + IST_OFFSET_MINUTES;
  totalMinutesIST = totalMinutesIST % (24 * 60);
  return {
    hour: Math.floor(totalMinutesIST / 60),
    minute: totalMinutesIST % 60,
  };
}

/**
 * Build a UTC cron expression from IST run times.
 * The UI collects times in IST; this converts to UTC before storing.
 */
function buildCron(freq: string, times: RunTime[], weekday: string): string {
  if (freq === "hourly") return "0 * * * *";

  const unique = times.filter((t, i, arr) =>
    arr.findIndex((x) => x.hour === t.hour && x.minute === t.minute) === i
  );

  // Convert each IST time to UTC
  const utcTimes = unique.map((t) => {
    const { hour, minute } = istToUtc(Number(t.hour), Number(t.minute));
    return { hour: String(hour), minute: String(minute) };
  });

  if (utcTimes.length === 1) {
    const { hour, minute } = utcTimes[0];
    if (freq === "daily") return `${minute} ${hour} * * *`;
    if (freq === "weekly") return `${minute} ${hour} * * ${weekday}`;
  }

  const sameMinute = utcTimes.every((t) => t.minute === utcTimes[0].minute);
  if (sameMinute) {
    const hours = utcTimes.map((t) => t.hour).join(",");
    if (freq === "daily") return `${utcTimes[0].minute} ${hours} * * *`;
    if (freq === "weekly") return `${utcTimes[0].minute} ${hours} * * ${weekday}`;
  }

  return utcTimes
    .map((t) => freq === "weekly"
      ? `${t.minute} ${t.hour} * * ${weekday}`
      : `${t.minute} ${t.hour} * * *`)
    .join("\n");
}

/** Parse a stored UTC cron back to IST for display in the form. */
function parseCronToIst(cronExpression: string): RunTime[] {
  const lines = cronExpression.split("\n").filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(" ");
    const utcMinute = Number(parts[0] ?? "0");
    const utcHour = Number(parts[1]?.split(",")[0] ?? "0");
    const ist = utcToIst(utcHour, utcMinute);
    return { hour: String(ist.hour), minute: String(ist.minute) };
  });
}

/** Show IST time preview for the cron expression. */
function cronPreviewIST(cronExpression: string): string {
  const lines = cronExpression.split("\n").filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(" ");
    const utcMinute = Number(parts[0] ?? "0");
    // Handle comma-separated hours (multiple times same minute)
    const hourStr = parts[1] ?? "0";
    const utcHours = hourStr.split(",").map(Number);
    const istTimes = utcHours.map((h) => {
      const ist = utcToIst(h, utcMinute);
      return `${String(ist.hour).padStart(2, "0")}:${String(ist.minute).padStart(2, "0")}`;
    });
    return istTimes.join(", ") + " IST";
  }).join(" | ");
}

export function ScheduleFormDialog({ open, schedule, tenants, onClose, onSaved }: {
  open: boolean; schedule: DeletionScheduleInput | null; tenants: Tenant[];
  onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const isEdit = !!schedule;

  const [tenantId, setTenantId] = useState("");
  const [name, setName] = useState("");
  const [scopeType, setScopeType] = useState("RESOURCE_GROUP");
  const [selectedTargets, setSelectedTargets] = useState<string[]>([]);
  const [excludeTagKey, setExcludeTagKey] = useState("donotdelete");
  const [notifyMinutes, setNotifyMinutes] = useState("60");
  const [notifyEmails, setNotifyEmails] = useState("");

  // Multiple run times
  const [freq, setFreq] = useState("daily");
  const [weekday, setWeekday] = useState("1");
  const [runTimes, setRunTimes] = useState<RunTime[]>([{ hour: "23", minute: "0" }]);

  const cronExpression = buildCron(freq, runTimes, weekday);

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [resourceGroups, setResourceGroups] = useState<ResourceGroup[]>([]);
  const [saving, setSaving] = useState(false);

  // ── Reset on open ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (schedule) {
      setTenantId(schedule.tenantId);
      setName(schedule.name);
      setScopeType(schedule.scopeType);
      setSelectedTargets(Array.isArray(schedule.targetIds) ? schedule.targetIds : []);
      setExcludeTagKey(schedule.excludeTagKey);
      setNotifyMinutes(String(schedule.notifyBeforeMinutes));
      setNotifyEmails(schedule.notifyEmails ?? "");
      // Parse existing UTC cron back to IST for display
      const parsed = parseCronToIst(schedule.cronExpression);
      setRunTimes(parsed.length ? parsed : [{ hour: "22", minute: "0" }]);
    } else {
      setTenantId(tenants[0]?.id ?? "");
      setName(""); setScopeType("RESOURCE_GROUP");
      setSelectedTargets([]); setExcludeTagKey("donotdelete");
      setNotifyMinutes("60"); setNotifyEmails("");
      setRunTimes([{ hour: "7", minute: "30" }]); // default 7:30 AM IST
      setFreq("daily"); setWeekday("1");
    }
  }, [schedule, open, tenants]);

  // ── Load subscriptions ────────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId) return;
    fetch(`/api/tenants/${tenantId}`)
      .then((r) => r.json())
      .then((d) => setSubscriptions(d.subscriptions ?? []))
      .catch(console.error);
  }, [tenantId]);

  // ── Load resource groups ──────────────────────────────────────────────────
  useEffect(() => {
    if (!tenantId || scopeType === "SUBSCRIPTION") return;
    fetch(`/api/resources/groups?tenantId=${tenantId}`)
      .then((r) => r.json())
      .then((d) => setResourceGroups(Array.isArray(d) ? d : []))
      .catch(console.error);
  }, [tenantId, scopeType]);

  // ── Run time helpers ──────────────────────────────────────────────────────
  function addRunTime() {
    setRunTimes((prev) => [...prev, { hour: "18", minute: "0" }]);
  }
  function removeRunTime(i: number) {
    setRunTimes((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateRunTime(i: number, field: "hour" | "minute", value: string) {
    setRunTimes((prev) => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  }

  function toggleTarget(val: string) {
    setSelectedTargets((prev) =>
      prev.includes(val) ? prev.filter((t) => t !== val) : [...prev, val]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedTargets.length) {
      toast({ variant: "destructive", title: "Select at least one target" });
      return;
    }
    setSaving(true);

    // For edits, only send scope/targets if they actually changed.
    // This avoids triggering an unnecessary PENDING_DRY_RUN reset.
    const scopeChanged = isEdit && (
      scopeType !== schedule!.scopeType ||
      selectedTargets.length !== schedule!.targetIds.length ||
      selectedTargets.some((t) => !schedule!.targetIds.includes(t)) ||
      schedule!.targetIds.some((t) => !selectedTargets.includes(t))
    );

    const body: Record<string, unknown> = {
      tenantId,   // always send — user can switch tenants on edit
      name,
      cronExpression,
      excludeTagKey,
      notifyBeforeMinutes: Number(notifyMinutes),
      notifyEmails,
    };

    // Always include scope/targets for new schedules.
    // For edits: only include if actually changed (prevents spurious approval resets).
    if (!isEdit || scopeChanged) {
      body.scopeType = scopeType;
      body.targetIds = selectedTargets;
    }
    const url = isEdit ? `/api/automation/schedules/${schedule!.id}` : "/api/automation/schedules";
    const method = isEdit ? "PATCH" : "POST";
    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        toast({ variant: "destructive", title: "Save failed", description: JSON.stringify(data.error) });
        return;
      }
      toast({ variant: "success", title: isEdit ? "Schedule updated" : "Schedule created" });
      onSaved();
    } catch {
      toast({ variant: "destructive", title: "Network error" });
    } finally {
      setSaving(false);
    }
  }

  const targetOptions = scopeType === "SUBSCRIPTION"
    ? subscriptions.map((s) => ({ value: s.subscriptionId, label: s.subscriptionName ?? s.subscriptionId }))
    : resourceGroups.map((rg) => ({ value: rg.name, label: `${rg.name} (${rg.subscriptionName})` }));

  // FIX 1: onInteractOutside prevents closing when clicking outside
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v && !saving) onClose(); }}>
      <DialogContent
        className="max-w-lg max-h-[90vh] overflow-y-auto"
        onInteractOutside={(e) => e.preventDefault()}  // ← prevents outside-click close
        onEscapeKeyDown={(e) => { if (saving) e.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Schedule" : "Create Deletion Schedule"}</DialogTitle>
          <DialogDescription>
            The first run will always be a dry-run. No resources will be deleted until you explicitly approve live deletions.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Tenant */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Tenant</label>
            <Select value={tenantId} onValueChange={setTenantId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {tenants.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <Input label="Schedule Name" value={name} onChange={(e) => setName(e.target.value)}
            placeholder="Nightly Training Cleanup" required />

          {/* Scope */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-1.5">Scope</label>
            <Select value={scopeType} onValueChange={(v) => { setScopeType(v); setSelectedTargets([]); }}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="RESOURCE_GROUP">Resource Group(s)</SelectItem>
                <SelectItem value="MULTIPLE_RESOURCE_GROUPS">Multiple Resource Groups</SelectItem>
                <SelectItem value="SUBSCRIPTION">Subscription</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Target selector */}
          {targetOptions.length > 0 && (
            <div>
              <label className="text-sm font-medium text-gray-700 block mb-1.5">
                Target(s) <span className="text-gray-400 font-normal">— select from existing resources</span>
              </label>
              <div className="max-h-44 overflow-y-auto border border-gray-200 rounded-md divide-y divide-gray-100">
                {targetOptions.map((opt) => (
                  <label key={opt.value}
                    className="flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 cursor-pointer select-none">
                    <input type="checkbox"
                      checked={selectedTargets.includes(opt.value)}
                      onChange={() => toggleTarget(opt.value)}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 shrink-0" />
                    <span className="text-sm text-gray-700">{opt.label}</span>
                  </label>
                ))}
              </div>
              {selectedTargets.length > 0 && (
                <p className="text-xs text-blue-600 mt-1">{selectedTargets.length} selected</p>
              )}
            </div>
          )}

          {/* FIX 2: Multiple run times */}
          <div className="rounded-lg border border-gray-200 p-3 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium text-gray-700">Schedule</label>
            </div>

            {/* Frequency + weekday */}
            <div className="flex gap-3">
              <div className="flex-1">
                <label className="text-xs text-gray-500 block mb-1">Frequency</label>
                <Select value={freq} onValueChange={setFreq}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Daily</SelectItem>
                    <SelectItem value="weekly">Weekly</SelectItem>
                    <SelectItem value="hourly">Hourly</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {freq === "weekly" && (
                <div className="flex-1">
                  <label className="text-xs text-gray-500 block mb-1">Day</label>
                  <Select value={weekday} onValueChange={setWeekday}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                        <SelectItem key={i} value={String(i)}>{d}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
            </div>

            {/* Run times list */}
            {freq !== "hourly" && (
              <div className="space-y-2">
                <label className="text-xs text-gray-500 block">
                  Run time(s) IST — add multiple for e.g. 6 PM and 11 PM
                </label>
                {runTimes.map((t, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 flex-1">
                      <div className="flex-1">
                        <label className="text-[10px] text-gray-400 block mb-0.5">Hour IST (0–23)</label>
                        <input
                          type="number" min="0" max="23" value={t.hour}
                          onChange={(e) => updateRunTime(i, "hour", e.target.value)}
                          className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="flex-1">
                        <label className="text-[10px] text-gray-400 block mb-0.5">Minute (0–59)</label>
                        <input
                          type="number" min="0" max="59" value={t.minute}
                          onChange={(e) => updateRunTime(i, "minute", e.target.value)}
                          className="h-9 w-full rounded-md border border-gray-300 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                    </div>
                    {runTimes.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeRunTime(i)}
                        className="mt-4 text-gray-400 hover:text-red-500 transition-colors"
                        aria-label="Remove time">
                        <X className="h-4 w-4" />
                      </button>
                    )}
                  </div>
                ))}

                <button
                  type="button"
                  onClick={addRunTime}
                  className="flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 mt-1">
                  <Plus className="h-3.5 w-3.5" />
                  Add another run time
                </button>
              </div>
            )}

            {/* Cron preview — shows IST time to confirm what user entered */}
            <div className="bg-gray-50 rounded p-2 space-y-1">
              <p className="text-xs text-gray-500 font-medium">
                Runs at: <span className="text-gray-800">{cronPreviewIST(cronExpression)}</span>
              </p>
              <p className="text-[10px] text-gray-400">
                Stored as UTC: <code className="text-gray-500">{cronExpression.split("\n").join(" | ")}</code>
              </p>
              {runTimes.length > 1 && (
                <p className="text-[10px] text-gray-400">
                  {runTimes.length} runs per {freq === "weekly" ? "week" : "day"}
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label="Exclude Tag Key" value={excludeTagKey}
              onChange={(e) => setExcludeTagKey(e.target.value)}
              placeholder="donotdelete" />
            <Input label="Notify before (min)" type="number" value={notifyMinutes}
              onChange={(e) => setNotifyMinutes(e.target.value)} min="0" max="1440" />
          </div>

          <Input
            label="Notify Emails (comma-separated, overrides .env)"
            value={notifyEmails}
            onChange={(e) => setNotifyEmails(e.target.value)}
            placeholder="ops@company.com, admin@company.com"
          />

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              {isEdit ? "Save changes" : "Create schedule"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
