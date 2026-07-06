"use client";
import { useState, useEffect } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";

interface DeletionRun {
  id: string; status: string; startedAt: string; completedAt: string | null;
  plannedResources: { name: string; type: string; resourceGroup: string }[] | null;
  deletedResources: { name: string }[] | null;
  failedResources: { name: string; error: string }[] | null;
  skippedResources: { name: string; reason: string }[] | null;
  cancelledBy: string | null;
}

const statusVariant: Record<string, "success" | "danger" | "warning" | "outline" | "default"> = {
  COMPLETED: "success", FAILED: "danger", DRY_RUN: "warning",
  EXECUTING: "default", CANCELLED: "outline", NOTIFIED: "warning",
};

export function RunHistoryPanel({ scheduleId, onClose }: {
  scheduleId: string; onClose: () => void;
}) {
  const [runs, setRuns] = useState<DeletionRun[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fetch(`/api/automation/schedules/${scheduleId}/run`)
      .then((r) => r.json())
      .then((d) => setRuns(Array.isArray(d) ? d : []))
      .finally(() => setLoading(false));
  }, [scheduleId]);

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Run History</DialogTitle>
        </DialogHeader>

        {loading ? (
          <p className="text-sm text-gray-400 py-8 text-center">Loading…</p>
        ) : runs.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No runs yet.</p>
        ) : (
          <div className="space-y-3">
            {runs.map((run) => (
              <div key={run.id} className="rounded-lg border border-gray-200">
                <button
                  className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-gray-50"
                  onClick={() => setExpanded(expanded === run.id ? null : run.id)}>
                  <div className="flex items-center gap-3">
                    <Badge variant={statusVariant[run.status] ?? "outline"} className="text-[10px]">
                      {run.status}
                    </Badge>
                    <span className="text-sm text-gray-700">
                      {new Date(run.startedAt).toLocaleString()}
                    </span>
                    {run.plannedResources && (
                      <span className="text-xs text-gray-400">{run.plannedResources.length} planned</span>
                    )}
                    {run.deletedResources && (
                      <span className="text-xs text-green-600">{run.deletedResources.length} deleted</span>
                    )}
                    {run.failedResources && run.failedResources.length > 0 && (
                      <span className="text-xs text-red-600">{run.failedResources.length} failed</span>
                    )}
                  </div>
                  <span className="text-gray-400 text-xs">{expanded === run.id ? "▲" : "▼"}</span>
                </button>

                {expanded === run.id && (
                  <div className="px-4 pb-4 space-y-3 border-t border-gray-100">
                    {run.plannedResources && run.plannedResources.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-gray-500 uppercase mt-3 mb-1">
                          Planned ({run.plannedResources.length})
                        </p>
                        <table className="w-full text-xs">
                          <thead>
                            <tr className="text-gray-400">
                              <th className="text-left pb-1">Name</th>
                              <th className="text-left pb-1">Type</th>
                              <th className="text-left pb-1">Resource Group</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-gray-100">
                            {run.plannedResources.map((r, i) => (
                              <tr key={i}>
                                <td className="py-1 text-gray-700">{r.name}</td>
                                <td className="py-1 text-gray-500">{r.type?.split("/").pop()}</td>
                                <td className="py-1 text-gray-500">{r.resourceGroup}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                    {run.failedResources && run.failedResources.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-red-500 uppercase mb-1">Failures</p>
                        <ul className="space-y-1">
                          {run.failedResources.map((f, i) => (
                            <li key={i} className="text-xs text-red-700 bg-red-50 rounded px-2 py-1">
                              <strong>{f.name}</strong>: {f.error}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    {run.skippedResources && run.skippedResources.length > 0 && (
                      <div>
                        <p className="text-xs font-semibold text-yellow-600 uppercase mb-1">
                          Skipped (exclude tag) — {run.skippedResources.length}
                        </p>
                        <p className="text-xs text-gray-500">
                          {run.skippedResources.map((s) => s.name).join(", ")}
                        </p>
                      </div>
                    )}
                    {run.cancelledBy && (
                      <p className="text-xs text-gray-500">Cancelled by: {run.cancelledBy}</p>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
