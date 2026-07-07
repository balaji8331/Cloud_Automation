"use client";
/**
 * /terminal/sessions — Super Admin session audit log.
 * Shows all past terminal sessions with full command history.
 */
import { useState, useEffect, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { Terminal, Clock, User, Building2, ChevronDown, ChevronRight, ArrowLeft } from "lucide-react";
import Link from "next/link";
import { formatDate } from "@/lib/utils";

interface TerminalSession {
  id: string;
  userId: string;
  tenantId: string;
  status: "ACTIVE" | "ENDED" | "ERROR";
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
  ipAddress: string | null;
  user: { id: string; email: string; name: string | null };
  tenant: { id: string; name: string };
  _count: { commands: number };
}

interface TerminalCommand {
  id: string;
  sessionId: string;
  commandText: string;
  executedAt: string;
}

function durationLabel(start: string, end: string | null) {
  if (!end) return "Active";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  if (m >= 60) return `${Math.floor(m / 60)}h ${(m % 60).toString().padStart(2, "0")}m`;
  return `${m}m ${s.toString().padStart(2, "0")}s`;
}

const statusStyle: Record<string, string> = {
  ACTIVE: "bg-green-100 text-green-700 border-green-200",
  ENDED: "bg-gray-100 text-gray-600 border-gray-200",
  ERROR: "bg-red-100 text-red-700 border-red-200",
};

const endReasonLabel: Record<string, string> = {
  idle_timeout: "Idle timeout",
  max_duration: "Max duration",
  user_disconnect: "User disconnected",
  container_exit: "Container exited",
  start_error: "Start error",
  error: "Error",
};

export default function TerminalSessionsPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [commands, setCommands] = useState<Record<string, TerminalCommand[]>>({});
  const [loadingCommands, setLoadingCommands] = useState<string | null>(null);

  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "SUPER_ADMIN") {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  const fetchSessions = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/terminal/sessions");
      if (res.ok) setSessions(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSessions(); }, [fetchSessions]);

  async function toggleSession(id: string) {
    if (expandedId === id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (commands[id]) return; // already loaded

    setLoadingCommands(id);
    try {
      const res = await fetch(`/api/terminal/sessions/${id}/commands`);
      if (res.ok) {
        const data = await res.json();
        setCommands((prev) => ({ ...prev, [id]: data }));
      }
    } finally {
      setLoadingCommands(null);
    }
  }

  if (status === "loading" || !session || session.user.role !== "SUPER_ADMIN") return null;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Link
          href="/terminal"
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Terminal
        </Link>
        <div className="flex-1" />
        <button
          onClick={fetchSessions}
          className="text-sm text-gray-500 hover:text-gray-700 underline transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-orange-100">
          <Terminal className="h-5 w-5 text-orange-600" />
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Terminal Session Audit</h1>
          <p className="text-sm text-gray-500">Full command history for all Super Admin terminal sessions</p>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">Total Sessions</p>
          <p className="text-2xl font-bold text-gray-900">{sessions.length}</p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">Active Now</p>
          <p className="text-2xl font-bold text-green-600">
            {sessions.filter((s) => s.status === "ACTIVE").length}
          </p>
        </div>
        <div className="rounded-xl border border-gray-200 bg-white p-4">
          <p className="text-xs text-gray-500 mb-1">Total Commands</p>
          <p className="text-2xl font-bold text-gray-900">
            {sessions.reduce((acc, s) => acc + s._count.commands, 0)}
          </p>
        </div>
      </div>

      {/* Sessions table */}
      <div className="rounded-xl border border-gray-200 bg-white overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-gray-400 text-sm">Loading sessions…</div>
        ) : sessions.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            No terminal sessions yet.
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {sessions.map((s) => (
              <div key={s.id}>
                {/* Session row */}
                <button
                  onClick={() => toggleSession(s.id)}
                  className="w-full flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors text-left"
                >
                  {/* Expand icon */}
                  <span className="text-gray-400 flex-shrink-0">
                    {expandedId === s.id
                      ? <ChevronDown className="h-4 w-4" />
                      : <ChevronRight className="h-4 w-4" />}
                  </span>

                  {/* Status */}
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${statusStyle[s.status]}`}>
                    {s.status}
                  </span>

                  {/* User */}
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <User className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-sm font-medium text-gray-900 truncate">
                      {s.user.name ?? s.user.email}
                    </span>
                    <span className="text-xs text-gray-400 truncate">{s.user.email}</span>
                  </div>

                  {/* Tenant */}
                  <div className="flex items-center gap-1.5 min-w-0 w-40">
                    <Building2 className="h-3.5 w-3.5 text-gray-400 flex-shrink-0" />
                    <span className="text-sm text-gray-700 truncate">{s.tenant.name}</span>
                  </div>

                  {/* Started */}
                  <div className="flex items-center gap-1 text-xs text-gray-500 w-36">
                    <Clock className="h-3 w-3" />
                    {formatDate(s.startedAt)}
                  </div>

                  {/* Duration */}
                  <span className="text-xs text-gray-500 w-24 text-right">
                    {durationLabel(s.startedAt, s.endedAt)}
                  </span>

                  {/* Command count */}
                  <span className="text-xs text-gray-400 w-20 text-right">
                    {s._count.commands} cmd{s._count.commands !== 1 ? "s" : ""}
                  </span>

                  {/* End reason */}
                  <span className="text-xs text-gray-400 w-28 text-right">
                    {s.endReason ? endReasonLabel[s.endReason] ?? s.endReason : "—"}
                  </span>
                </button>

                {/* Command history drawer */}
                {expandedId === s.id && (
                  <div className="bg-[#0d1117] mx-4 mb-4 rounded-xl overflow-hidden border border-gray-800">
                    <div className="flex items-center gap-2 px-4 py-2.5 border-b border-gray-800 bg-[#161b22]">
                      <Terminal className="h-3.5 w-3.5 text-orange-400" />
                      <span className="text-xs font-mono text-orange-300">Command History</span>
                      <span className="ml-auto text-xs text-gray-600 font-mono">{s.id}</span>
                    </div>

                    {loadingCommands === s.id ? (
                      <div className="py-8 text-center text-gray-600 text-xs font-mono">
                        Loading…
                      </div>
                    ) : (commands[s.id]?.length ?? 0) === 0 ? (
                      <div className="py-8 text-center text-gray-600 text-xs font-mono">
                        No commands recorded for this session.
                      </div>
                    ) : (
                      <div className="divide-y divide-gray-800/50">
                        {commands[s.id].map((cmd, i) => (
                          <div key={cmd.id} className="flex items-start gap-4 px-4 py-2.5 font-mono">
                            <span className="text-gray-700 text-xs w-6 flex-shrink-0 select-none">
                              {(i + 1).toString().padStart(2, "0")}
                            </span>
                            <span className="text-green-400 text-xs mr-1 flex-shrink-0">$</span>
                            <span className="text-gray-200 text-xs flex-1 break-all">
                              {cmd.commandText}
                            </span>
                            <span className="text-gray-600 text-xs flex-shrink-0 tabular-nums">
                              {new Date(cmd.executedAt).toLocaleTimeString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
