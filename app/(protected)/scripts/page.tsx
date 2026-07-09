"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AlertCircle, CheckCircle, XCircle, Clock, Trash2, Calendar, Plus, X } from "lucide-react";

// IST is UTC+5:30
const IST_OFFSET_MINUTES = 5 * 60 + 30;

interface RunTime { hour: string; minute: string; }

function istToUtc(hour: number, minute: number): { hour: number; minute: number } {
  const totalMinutesIST = hour * 60 + minute;
  let totalMinutesUTC = totalMinutesIST - IST_OFFSET_MINUTES;
  totalMinutesUTC = ((totalMinutesUTC % (24 * 60)) + 24 * 60) % (24 * 60);
  return {
    hour: Math.floor(totalMinutesUTC / 60),
    minute: totalMinutesUTC % 60,
  };
}

function utcToIst(hour: number, minute: number): { hour: number; minute: number } {
  const totalMinutesUTC = hour * 60 + minute;
  let totalMinutesIST = totalMinutesUTC + IST_OFFSET_MINUTES;
  totalMinutesIST = totalMinutesIST % (24 * 60);
  return {
    hour: Math.floor(totalMinutesIST / 60),
    minute: totalMinutesIST % 60,
  };
}

function buildCron(freq: string, times: RunTime[], weekday: string): string {
  if (freq === "hourly") return "0 * * * *";

  const unique = times.filter((t, i, arr) =>
    arr.findIndex((x) => x.hour === t.hour && x.minute === t.minute) === i
  );

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

function cronPreviewIST(cronExpression: string): string {
  if (!cronExpression) return "";
  const lines = cronExpression.split("\n").filter(Boolean);
  return lines.map((line) => {
    const parts = line.split(" ");
    const utcMinute = Number(parts[0] ?? "0");
    const hourStr = parts[1] ?? "0";
    const utcHours = hourStr.split(",").map(Number);
    const istTimes = utcHours.map((h) => {
      const ist = utcToIst(h, utcMinute);
      return `${String(ist.hour).padStart(2, "0")}:${String(ist.minute).padStart(2, "0")}`;
    });
    return istTimes.join(", ") + " IST";
  }).join(" | ");
}

export default function ScriptRunnerPage() {
  const [activeTab, setActiveTab] = useState<"new" | "logs" | "scheduled">("new");
  const { toast } = useToast();
  
  // Data State
  const [tenants, setTenants] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  const [schedules, setSchedules] = useState<any[]>([]);
  
  // Form State
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedSubId, setSelectedSubId] = useState("");
  const [targetResourceGroup, setTargetResourceGroup] = useState("");
  const [scriptType, setScriptType] = useState<"bash" | "powershell">("bash");
  const [scriptContent, setScriptContent] = useState("#!/bin/bash\naz account show\n");
  const [customCron, setCustomCron] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"none" | "scheduled" | "custom">("none");
  const [freq, setFreq] = useState("daily");
  const [weekday, setWeekday] = useState("1");
  const [runTimes, setRunTimes] = useState<RunTime[]>([{ hour: "7", minute: "30" }]);
  const builtCronExpression = buildCron(freq, runTimes, weekday);
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // Modal/Detail State
  const [selectedLog, setSelectedLog] = useState<any>(null);

  function addRunTime() {
    setRunTimes((prev) => [...prev, { hour: "18", minute: "0" }]);
  }
  function removeRunTime(i: number) {
    setRunTimes((prev) => prev.filter((_, idx) => idx !== i));
  }
  function updateRunTime(i: number, field: "hour" | "minute", value: string) {
    setRunTimes((prev) => prev.map((t, idx) => idx === i ? { ...t, [field]: value } : t));
  }

  useEffect(() => {
    fetch("/api/tenants")
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) setTenants(data);
      })
      .catch(console.error);
  }, []);

  useEffect(() => {
    if (activeTab === "logs") {
      fetchLogs();
      const interval = setInterval(fetchLogs, 5000);
      return () => clearInterval(interval);
    }
    if (activeTab === "scheduled") {
      fetchSchedules();
      const interval = setInterval(fetchSchedules, 10000);
      return () => clearInterval(interval);
    }
  }, [activeTab]);

  const fetchLogs = async () => {
    try {
      const res = await fetch("/api/scripts/logs");
      const data = await res.json();
      if (Array.isArray(data)) setLogs(data);
    } catch (e) {
      console.error(e);
    }
  };

  const fetchSchedules = async () => {
    try {
      const res = await fetch("/api/scripts/schedules");
      const data = await res.json();
      if (Array.isArray(data)) setSchedules(data);
    } catch (e) {
      console.error(e);
    }
  };

  const handleRun = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTenantId || !scriptContent) return;

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/scripts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          subscriptionId: selectedSubId || undefined,
          targetResourceGroup: targetResourceGroup || undefined,
          name: name || undefined,
          scriptType,
          scriptContent
        })
      });

      const data = await res.json();
      if (res.ok) {
        toast({ title: "Script Queued", description: "The script is now executing." });
        setActiveTab("logs");
      } else {
        toast({ variant: "destructive", title: "Error", description: data.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: "Failed to queue script." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteLog = async (id: string) => {
    if (!confirm("Are you sure you want to delete this run log?")) return;
    try {
      await fetch(`/api/scripts/logs/${id}`, { method: "DELETE" });
      fetchLogs();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete log." });
    }
  };

  const handleDeleteSchedule = async (id: string) => {
    if (!confirm("Are you sure you want to delete this schedule?")) return;
    try {
      await fetch(`/api/scripts/schedules/${id}`, { method: "DELETE" });
      fetchSchedules();
    } catch (e) {
      toast({ variant: "destructive", title: "Error", description: "Failed to delete schedule." });
    }
  };

  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    
    console.log("Create Schedule validation:", { isSubmitting, scheduleMode, name, scriptContent, selectedTenantId });

    let finalCron = "";
    if (scheduleMode === "custom") {
      finalCron = customCron;
    } else if (scheduleMode === "scheduled") {
      finalCron = builtCronExpression;
    }

    const newErrors: Record<string, string> = {};
    if (scheduleMode === "none") newErrors.scheduleMode = "Please select a recurring schedule mode.";
    if (!selectedTenantId) newErrors.tenantId = "Tenant is required.";
    if (!scriptContent) newErrors.scriptContent = "Script Content is required.";
    if (scheduleMode !== "none" && !finalCron) newErrors.cron = "Valid schedule is required.";
    if (!name) newErrors.name = "Run Name is required for scheduled scripts.";

    if (Object.keys(newErrors).length > 0) {
      setErrors(newErrors);
      return;
    }
    setErrors({});

    setIsSubmitting(true);
    try {
      const res = await fetch("/api/scripts/schedules", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: selectedTenantId,
          subscriptionId: selectedSubId || undefined,
          targetResourceGroup: targetResourceGroup || undefined,
          name,
          scriptType,
          scriptContent,
          cronExpression: finalCron
        })
      });

      const data = await res.json();
      if (res.ok) {
        toast({ title: "Schedule Created", description: "The recurring script has been scheduled." });
        setActiveTab("scheduled");
      } else {
        toast({ variant: "destructive", title: "Error", description: data.error });
      }
    } catch (err: any) {
      toast({ variant: "destructive", title: "Error", description: "Failed to create schedule." });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRerun = (log: any) => {
    setSelectedTenantId(log.tenantId);
    setSelectedSubId(log.subscriptionId || "");
    setTargetResourceGroup(log.targetResourceGroup || "");
    setScriptType(log.scriptType);
    setScriptContent(log.scriptContent);
    setName(log.name ? `${log.name} (Rerun)` : "");
    setSelectedLog(null);
    setActiveTab("new");
  };

  const selectedTenant = tenants.find(t => t.id === selectedTenantId);

  return (
    <div className="p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">On-Demand Script Runner</h1>
          <p className="text-muted-foreground mt-2">
            Execute arbitrary scripts safely within isolated Azure Container Instances.
          </p>
        </div>
      </div>

      <div className="flex border-b border-gray-200">
        <button
          className={`px-4 py-2 font-medium ${activeTab === "new" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
          onClick={() => setActiveTab("new")}
        >
          New Run
        </button>
        <button
          className={`px-4 py-2 font-medium ${activeTab === "scheduled" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
          onClick={() => setActiveTab("scheduled")}
        >
          Scheduled Scripts
        </button>
        <button
          className={`px-4 py-2 font-medium ${activeTab === "logs" ? "border-b-2 border-blue-600 text-blue-600" : "text-gray-500 hover:text-gray-700"}`}
          onClick={() => setActiveTab("logs")}
        >
          Execution Logs
        </button>
      </div>

      {activeTab === "new" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-red-600 flex items-center gap-2">
              <AlertCircle className="w-5 h-5" />
              DANGER: Immediate Execution
            </CardTitle>
            <CardDescription>
              This script will execute immediately with live Azure CLI access to the selected tenant. There is no undo.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleRun} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Tenant *</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    value={selectedTenantId}
                    onChange={(e) => { setSelectedTenantId(e.target.value); setErrors(prev => ({ ...prev, tenantId: "" })); }}
                  >
                    <option value="" disabled>Select Tenant</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  {errors.tenantId && <p className="text-xs text-red-500 mt-1">{errors.tenantId}</p>}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Subscription (Optional)</label>
                  <select
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    value={selectedSubId}
                    onChange={(e) => setSelectedSubId(e.target.value)}
                  >
                    <option value="">Any / Default</option>
                    {selectedTenant?.subscriptions?.map((s: any) => (
                      <option key={s.id} value={s.subscriptionId}>
                        {s.subscriptionName || s.subscriptionId}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-sm font-medium">Target Resource Group (Optional)</label>
                <div className="text-xs text-muted-foreground mb-2">
                  This is informational only for your script's reference (injected as $TARGET_RESOURCE_GROUP) — it does not restrict which resources the script can actually access. The script runs with the full permissions of the tenant's service principal.
                </div>
                <input
                  className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                  placeholder="e.g. rg-production"
                  value={targetResourceGroup}
                  onChange={(e) => setTargetResourceGroup(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Run Name {scheduleMode !== "none" ? "*" : "(Optional)"}</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    placeholder="e.g. Cleanup orphaned disks"
                    value={name}
                    onChange={(e) => { setName(e.target.value); setErrors(prev => ({ ...prev, name: "" })); }}
                  />
                  {errors.name && <p className="text-xs text-red-500">{errors.name}</p>}
                </div>
                
                <div className="space-y-2">
                  <label className="text-sm font-medium">Script Type</label>
                  <div className="flex gap-4 items-center h-10">
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={scriptType === "bash"}
                        onChange={() => setScriptType("bash")}
                      />
                      Bash (Azure CLI)
                    </label>
                    <label className="flex items-center gap-2">
                      <input
                        type="radio"
                        checked={scriptType === "powershell"}
                        onChange={() => setScriptType("powershell")}
                      />
                      PowerShell
                    </label>
                  </div>
                </div>
              </div>

              <div className="space-y-2 pt-2">
                <div className="flex justify-between items-center">
                  <label className="text-sm font-medium">Script Content *</label>
                </div>
                <textarea
                  className="flex w-full rounded-md border border-input bg-[#1e1e1e] text-[#d4d4d4] px-4 py-4 text-sm font-mono ring-offset-background h-64 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  value={scriptContent}
                  onChange={(e) => { setScriptContent(e.target.value); setErrors(prev => ({ ...prev, scriptContent: "" })); }}
                  required
                />
                {errors.scriptContent && <p className="text-xs text-red-500 mt-1">{errors.scriptContent}</p>}
              </div>

              <div className="space-y-4 pt-4 border-t mt-6">
                <div>
                  <label className="text-sm font-medium">Recurring Schedule (Optional)</label>
                  <div className="text-xs text-muted-foreground mb-3">
                    Set a schedule to run this script automatically. A Name is required for scheduled scripts.
                  </div>
                  <div className="flex gap-4 mb-3">
                    <select
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                      value={scheduleMode}
                      onChange={(e) => { setScheduleMode(e.target.value as any); setErrors(prev => ({ ...prev, scheduleMode: "" })); }}
                    >
                      <option value="none">No Schedule (Run Once)</option>
                      <option value="scheduled">Standard Schedule</option>
                      <option value="custom">Custom Cron Expression</option>
                    </select>
                  </div>
                  {errors.scheduleMode && <p className="text-xs text-red-500 mb-3">{errors.scheduleMode}</p>}
                  
                  {scheduleMode === "scheduled" && (
                    <div className="rounded-lg border border-gray-200 p-4 space-y-4 bg-gray-50/50">
                      <div className="flex gap-4">
                        <div className="flex-1">
                          <label className="text-xs text-gray-500 block mb-1">Frequency</label>
                          <select
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                            value={freq}
                            onChange={(e) => setFreq(e.target.value)}
                          >
                            <option value="daily">Daily</option>
                            <option value="weekly">Weekly</option>
                            <option value="hourly">Hourly</option>
                          </select>
                        </div>
                        {freq === "weekly" && (
                          <div className="flex-1">
                            <label className="text-xs text-gray-500 block mb-1">Day</label>
                            <select
                              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                              value={weekday}
                              onChange={(e) => setWeekday(e.target.value)}
                            >
                              {["Sun","Mon","Tue","Wed","Thu","Fri","Sat"].map((d, i) => (
                                <option key={i} value={String(i)}>{d}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>

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
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                                  />
                                </div>
                                <div className="flex-1">
                                  <label className="text-[10px] text-gray-400 block mb-0.5">Minute (0–59)</label>
                                  <input
                                    type="number" min="0" max="59" value={t.minute}
                                    onChange={(e) => updateRunTime(i, "minute", e.target.value)}
                                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                                  />
                                </div>
                              </div>
                              {runTimes.length > 1 && (
                                <button
                                  type="button"
                                  onClick={() => removeRunTime(i)}
                                  className="mt-4 text-gray-400 hover:text-red-500 transition-colors">
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

                      <div className="bg-white border rounded p-3 space-y-1 mt-2">
                        <p className="text-xs text-gray-500 font-medium">
                          Runs at: <span className="text-gray-800">{cronPreviewIST(builtCronExpression)}</span>
                        </p>
                        <p className="text-[10px] text-gray-400">
                          Stored as UTC: <code className="text-gray-500">{builtCronExpression.split("\n").join(" | ")}</code>
                        </p>
                        {runTimes.length > 1 && (
                          <p className="text-[10px] text-gray-400">
                            {runTimes.length} runs per {freq === "weekly" ? "week" : "day"}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {scheduleMode === "custom" && (
                    <input
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                      placeholder="* * * * * (Standard Cron format)"
                      value={customCron}
                      onChange={(e) => setCustomCron(e.target.value)}
                    />
                  )}
                </div>
              </div>

              <div className="pt-4 flex gap-4">
                <Button type="button" onClick={handleRun} disabled={isSubmitting} className="flex-1 bg-blue-600 hover:bg-blue-700 text-white">
                  {isSubmitting ? "Queueing..." : "Execute Immediately"}
                </Button>
                <Button type="button" onClick={handleCreateSchedule} disabled={isSubmitting} className="flex-1 bg-green-600 hover:bg-green-700 text-white">
                  Create Schedule
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      {activeTab === "logs" && (
        <Card>
          <CardContent className="p-0">
            {selectedLog ? (
              <div className="p-6 space-y-4">
                <div className="flex justify-between items-start border-b pb-4">
                  <div>
                    <h2 className="text-xl font-bold">{selectedLog.name || "Unnamed Script"}</h2>
                    <p className="text-sm text-gray-500">
                      Ran on {selectedLog.tenant?.name} by {selectedLog.triggeredBy?.name || selectedLog.triggeredBy?.email}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" onClick={() => setSelectedLog(null)}>Back to List</Button>
                    <Button variant="default" onClick={() => handleRerun(selectedLog)}>Re-run Script</Button>
                  </div>
                </div>
                <div className="bg-[#1e1e1e] text-[#d4d4d4] p-4 rounded-md font-mono text-sm overflow-auto max-h-[500px] whitespace-pre-wrap">
                  {selectedLog.output || "Waiting for output..."}
                </div>
              </div>
            ) : (
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                  <tr>
                    <th className="px-6 py-3">Status</th>
                    <th className="px-6 py-3">Tenant</th>
                    <th className="px-6 py-3">Name</th>
                    <th className="px-6 py-3">Triggered By</th>
                    <th className="px-6 py-3">Started</th>
                    <th className="px-6 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {logs.map((log: any) => (
                    <tr key={log.id} className="bg-white border-b hover:bg-gray-50">
                      <td className="px-6 py-4">
                        {log.status === "completed" && <Badge variant="success" className="bg-green-100 text-green-800"><CheckCircle className="w-3 h-3 mr-1"/> Completed</Badge>}
                        {log.status === "failed" && <Badge variant="destructive" className="bg-red-100 text-red-800"><XCircle className="w-3 h-3 mr-1"/> Failed</Badge>}
                        {log.status === "running" && <Badge variant="default" className="bg-blue-100 text-blue-800 animate-pulse"><Clock className="w-3 h-3 mr-1"/> Running</Badge>}
                      </td>
                      <td className="px-6 py-4 font-medium">{log.tenant?.name}</td>
                      <td className="px-6 py-4">{log.name || "-"}</td>
                      <td className="px-6 py-4">{log.triggeredBy?.name || log.triggeredBy?.email}</td>
                      <td className="px-6 py-4">{new Date(log.startedAt).toLocaleString()}</td>
                      <td className="px-6 py-4 text-right flex justify-end gap-2">
                        <Button size="sm" variant="outline" onClick={() => setSelectedLog(log)}>View</Button>
                        <Button size="icon" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteLog(log.id)}>
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {logs.length === 0 && (
                    <tr>
                      <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                        No script runs found.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            )}
          </CardContent>
        </Card>
      )}

      {activeTab === "scheduled" && (
        <Card>
          <CardContent className="p-0">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-gray-700 uppercase bg-gray-50 border-b">
                <tr>
                  <th className="px-6 py-3">Tenant</th>
                  <th className="px-6 py-3">Name</th>
                  <th className="px-6 py-3">Cron</th>
                  <th className="px-6 py-3">Next Run</th>
                  <th className="px-6 py-3">Created By</th>
                  <th className="px-6 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {schedules.map((schedule: any) => (
                  <tr key={schedule.id} className="bg-white border-b hover:bg-gray-50">
                    <td className="px-6 py-4 font-medium">{schedule.tenant?.name}</td>
                    <td className="px-6 py-4">{schedule.name}</td>
                    <td className="px-6 py-4 font-mono">{schedule.cronExpression}</td>
                    <td className="px-6 py-4 text-blue-600">{new Date(schedule.nextRunAt).toLocaleString()}</td>
                    <td className="px-6 py-4">{schedule.createdBy?.email}</td>
                    <td className="px-6 py-4 text-right">
                      <Button size="icon" variant="ghost" className="text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => handleDeleteSchedule(schedule.id)}>
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                ))}
                {schedules.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-6 py-8 text-center text-gray-500">
                      No active schedules found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode, className?: string, variant?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>{children}</span>;
}
