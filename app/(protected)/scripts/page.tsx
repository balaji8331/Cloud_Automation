"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { AlertCircle, CheckCircle, XCircle, Clock } from "lucide-react";

export default function ScriptRunnerPage() {
  const [activeTab, setActiveTab] = useState<"new" | "logs">("new");
  const { toast } = useToast();
  
  // Data State
  const [tenants, setTenants] = useState<any[]>([]);
  const [logs, setLogs] = useState<any[]>([]);
  
  // Form State
  const [selectedTenantId, setSelectedTenantId] = useState("");
  const [selectedSubId, setSelectedSubId] = useState("");
  const [targetResourceGroup, setTargetResourceGroup] = useState("");
  const [scriptType, setScriptType] = useState<"bash" | "powershell">("bash");
  const [scriptContent, setScriptContent] = useState("");
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Modal/Detail State
  const [selectedLog, setSelectedLog] = useState<any>(null);

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
                    onChange={(e) => setSelectedTenantId(e.target.value)}
                    required
                  >
                    <option value="" disabled>Select Tenant</option>
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
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
                  <label className="text-sm font-medium">Run Name (Optional)</label>
                  <input
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background"
                    placeholder="e.g. Cleanup orphaned disks"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                  />
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
                  placeholder={scriptType === "bash" ? "#!/bin/bash\naz account show" : "Get-AzContext"}
                  value={scriptContent}
                  onChange={(e) => setScriptContent(e.target.value)}
                  required
                />
              </div>

              <div className="pt-4">
                <Button type="submit" disabled={isSubmitting} className="w-full bg-blue-600 hover:bg-blue-700 text-white">
                  {isSubmitting ? "Queueing..." : "Execute Script"}
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
                      <td className="px-6 py-4 text-right">
                        <Button size="sm" variant="outline" onClick={() => setSelectedLog(log)}>View Logs</Button>
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
    </div>
  );
}

function Badge({ children, className }: { children: React.ReactNode, className?: string, variant?: string }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${className}`}>{children}</span>;
}
