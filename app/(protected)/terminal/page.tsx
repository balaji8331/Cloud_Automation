"use client";
/**
 * /terminal — Super Admin only.
 * Embedded Azure CLI terminal with Docker-isolated sessions.
 * Shows warning banner, tenant selector, xterm.js terminal, context banner.
 */
import { useEffect, useRef, useState, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Terminal as TerminalIcon, X, ChevronRight, Clock, Wifi, WifiOff, History } from "lucide-react";
import Link from "next/link";

interface Tenant {
  id: string;
  name: string;
  azureTenantId: string;
  status: string;
  subscriptions: { subscriptionId: string; subscriptionName: string | null }[];
}

interface SessionInfo {
  sessionId: string;
  tenant: {
    id: string;
    name: string;
    azureTenantId: string;
    subscriptions: { subscriptionId: string; subscriptionName: string | null }[];
  };
  banner: string;
}

const getWsUrl = () => {
  if (typeof window === "undefined") return "ws://localhost:3001";
  if (process.env.NEXT_PUBLIC_TERMINAL_WS_URL) return process.env.NEXT_PUBLIC_TERMINAL_WS_URL;
  
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") {
    return `ws://${host}:3001`;
  }
  
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
};
const WARNING_KEY = "terminal_warning_dismissed";

export default function TerminalPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const terminalRef = useRef<HTMLDivElement>(null);
  const xtermRef = useRef<import("@xterm/xterm").Terminal | null>(null);
  const fitRef = useRef<import("@xterm/addon-fit").FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [selectedTenantId, setSelectedTenantId] = useState<string>("");
  const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
  const [wsStatus, setWsStatus] = useState<"disconnected" | "connecting" | "connected" | "authenticated">("disconnected");
  const [showWarning, setShowWarning] = useState(false);
  const [warningDismissed, setWarningDismissed] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [terminalReady, setTerminalReady] = useState(false);

  // ── Auth guard ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (status === "loading") return;
    if (!session || session.user.role !== "SUPER_ADMIN") {
      router.replace("/dashboard");
    }
  }, [session, status, router]);

  // ── Show warning on first load ──────────────────────────────────────────────
  useEffect(() => {
    const dismissed = sessionStorage.getItem(WARNING_KEY);
    if (!dismissed) {
      setShowWarning(true);
    } else {
      setWarningDismissed(true);
    }
  }, []);

  // ── Load tenants ────────────────────────────────────────────────────────────
  useEffect(() => {
    fetch("/api/tenants")
      .then((r) => r.json())
      .then((data) => setTenants(Array.isArray(data) ? data : data.tenants ?? []))
      .catch(() => {});
  }, []);

  // ── Init xterm.js ───────────────────────────────────────────────────────────
  const initTerminal = useCallback(async () => {
    if (!terminalRef.current || xtermRef.current) return;

    const { Terminal } = await import("@xterm/xterm");
    const { FitAddon } = await import("@xterm/addon-fit");

    const term = new Terminal({
      theme: {
        background: "#0d1117",
        foreground: "#e6edf3",
        cursor: "#58a6ff",
        cursorAccent: "#0d1117",
        selectionBackground: "#264f78",
        black: "#484f58",
        red: "#ff7b72",
        green: "#3fb950",
        yellow: "#d29922",
        blue: "#58a6ff",
        magenta: "#bc8cff",
        cyan: "#39c5cf",
        white: "#b1bac4",
        brightBlack: "#6e7681",
        brightRed: "#ffa198",
        brightGreen: "#56d364",
        brightYellow: "#e3b341",
        brightBlue: "#79c0ff",
        brightMagenta: "#d2a8ff",
        brightCyan: "#56d4dd",
        brightWhite: "#f0f6fc",
      },
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", monospace',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: "block",
      scrollback: 5000,
      allowTransparency: true,
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(terminalRef.current);
    fit.fit();

    xtermRef.current = term;
    fitRef.current = fit;
    setTerminalReady(true);

    term.writeln("\x1b[38;5;208m╔══════════════════════════════════════════════════════╗\x1b[0m");
    term.writeln("\x1b[38;5;208m║         Azure CLI Terminal — Super Admin Mode         ║\x1b[0m");
    term.writeln("\x1b[38;5;208m╚══════════════════════════════════════════════════════╝\x1b[0m");
    term.writeln("");
    term.writeln("\x1b[90mConnecting to terminal server…\x1b[0m");

    // Resize observer
    const ro = new ResizeObserver(() => { try { fit.fit(); } catch {} });
    ro.observe(terminalRef.current!);

    return () => ro.disconnect();
  }, []);

  // ── Connect WebSocket ────────────────────────────────────────────────────────
  const connectWS = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }

    setWsStatus("connecting");
    const ws = new WebSocket(getWsUrl());
    wsRef.current = ws;
    ws.binaryType = "arraybuffer";

    ws.onopen = () => {
      setWsStatus("connected");
    };

    ws.onmessage = (evt) => {
      const term = xtermRef.current;
      if (!term) return;

      // Try JSON protocol messages first
      if (typeof evt.data === "string") {
        try {
          const msg = JSON.parse(evt.data);
          if (msg.type === "authenticated") {
            setWsStatus("authenticated");
            term.writeln("\x1b[32m✓ Authenticated as Super Admin\x1b[0m");
            term.writeln("\x1b[90mSelect a tenant from the dropdown above to start a session.\x1b[0m");
          } else if (msg.type === "session_started") {
            setSessionInfo(msg);
            startElapsedTimer();
            term.clear();
            term.writeln(`\x1b[32m✓ Connected to ${msg.tenant.name}\x1b[0m`);
            term.writeln(`\x1b[90m${msg.banner}\x1b[0m`);
            term.writeln("");
          } else if (msg.type === "info") {
            term.writeln(`\x1b[90m${msg.message}\x1b[0m`);
          } else if (msg.type === "error") {
            term.writeln(`\x1b[31m✗ ${msg.message}\x1b[0m`);
          }
          return;
        } catch {
          // Fall through to binary/raw write
        }
      }

      // Raw terminal output from container
      if (evt.data instanceof ArrayBuffer) {
        term.write(new Uint8Array(evt.data));
      } else {
        term.write(evt.data);
      }
    };

    ws.onclose = (evt) => {
      setWsStatus("disconnected");
      setSessionInfo(null);
      stopElapsedTimer();
      xtermRef.current?.writeln(`\r\n\x1b[31mConnection closed (${evt.code})\x1b[0m`);
    };

    ws.onerror = () => {
      setWsStatus("disconnected");
      xtermRef.current?.writeln("\r\n\x1b[31m✗ WebSocket error. Is the terminal server running on port 3001?\x1b[0m");
    };
  }, []);

  // Wire xterm input → WS
  useEffect(() => {
    if (!terminalReady || !xtermRef.current) return;
    connectWS();

    const term = xtermRef.current;
    const disposable = term.onData((data) => {
      if (wsRef.current?.readyState === WebSocket.OPEN) {
        wsRef.current.send(data);
      }
    });

    return () => {
      disposable.dispose();
      wsRef.current?.close();
    };
  }, [terminalReady, connectWS]);

  // ── Session timer ────────────────────────────────────────────────────────────
  function startElapsedTimer() {
    stopElapsedTimer();
    setElapsed(0);
    timerRef.current = setInterval(() => setElapsed((s) => s + 1), 1000);
  }
  function stopElapsedTimer() {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  }
  useEffect(() => () => stopElapsedTimer(), []);

  function formatElapsed(secs: number) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return h > 0
      ? `${h}h ${m.toString().padStart(2, "0")}m`
      : `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  }

  // ── Start session ─────────────────────────────────────────────────────────
  function startSession() {
    if (!selectedTenantId || wsStatus !== "authenticated") return;
    wsRef.current?.send(JSON.stringify({ type: "select_tenant", tenantId: selectedTenantId }));
  }

  function disconnectSession() {
    wsRef.current?.close(1000, "User disconnect");
    stopElapsedTimer();
    setSessionInfo(null);
    xtermRef.current?.writeln("\r\n\x1b[33mSession terminated by user.\x1b[0m");
  }

  // ── Warning dismissal ─────────────────────────────────────────────────────
  function dismissWarning() {
    sessionStorage.setItem(WARNING_KEY, "1");
    setShowWarning(false);
    setWarningDismissed(true);
    initTerminal();
  }

  if (status === "loading") return null;
  if (!session || session.user.role !== "SUPER_ADMIN") return null;

  const statusColors: Record<typeof wsStatus, string> = {
    disconnected: "text-red-400",
    connecting: "text-yellow-400",
    connected: "text-yellow-400",
    authenticated: "text-green-400",
  };
  const statusLabels: Record<typeof wsStatus, string> = {
    disconnected: "Disconnected",
    connecting: "Connecting…",
    connected: "Authenticating…",
    authenticated: sessionInfo ? "Session Active" : "Ready",
  };

  return (
    <div className="h-full flex flex-col gap-0 bg-[#0d1117] rounded-xl overflow-hidden border border-orange-900/30 shadow-2xl">
      {/* ── Warning modal ──────────────────────────────────────────────────────── */}
      {showWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm">
          <div className="relative max-w-lg w-full mx-4 bg-[#161b22] border border-orange-500/50 rounded-2xl p-8 shadow-2xl">
            <div className="flex items-start gap-4 mb-6">
              <div className="flex-shrink-0 w-12 h-12 rounded-full bg-orange-500/20 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-orange-400" />
              </div>
              <div>
                <h2 className="text-lg font-bold text-white mb-1">Live Resource Access Warning</h2>
                <p className="text-sm text-gray-400">Super Admin Terminal</p>
              </div>
            </div>
            <div className="space-y-3 text-sm text-gray-300 mb-8">
              <p>
                Commands run in this terminal execute <strong className="text-orange-300">directly against live Azure resources</strong> in the selected tenant.
              </p>
              <p>
                There are <strong className="text-red-400">no dry-run or approval safeguards</strong> in this terminal, unlike the Automation feature.
              </p>
              <p>
                Every command you run is <strong className="text-green-400">logged permanently</strong> with your identity and timestamp and cannot be deleted.
              </p>
              <div className="mt-4 p-3 rounded-lg bg-red-950/40 border border-red-800/40 text-red-300 text-xs">
                ⚠ Destructive commands (az group delete, az vm deallocate, etc.) execute immediately with no confirmation prompt.
              </div>
            </div>
            <button
              onClick={dismissWarning}
              className="w-full py-3 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-semibold text-sm transition-colors"
            >
              I Understand — Open Terminal
            </button>
          </div>
        </div>
      )}

      {/* ── Top bar ───────────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-3 bg-[#161b22] border-b border-gray-800/60">
        {/* Title */}
        <div className="flex items-center gap-2 min-w-0">
          <TerminalIcon className="h-4 w-4 text-orange-400 flex-shrink-0" />
          <span className="text-sm font-semibold text-orange-300">Azure CLI Terminal</span>
          <span className="text-xs text-gray-600 mx-1">|</span>
          <span className="text-xs text-gray-500">Super Admin</span>
        </div>

        <div className="flex-1" />

        {/* WS Status */}
        <div className={`flex items-center gap-1.5 text-xs ${statusColors[wsStatus]}`}>
          {wsStatus === "disconnected"
            ? <WifiOff className="h-3.5 w-3.5" />
            : <Wifi className="h-3.5 w-3.5" />}
          {statusLabels[wsStatus]}
        </div>

        {/* Session timer */}
        {sessionInfo && (
          <div className="flex items-center gap-1 text-xs text-gray-500 bg-gray-800/60 rounded-lg px-2.5 py-1">
            <Clock className="h-3 w-3" />
            {formatElapsed(elapsed)}
          </div>
        )}

        {/* Session history link */}
        <Link
          href="/terminal/sessions"
          className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-300 transition-colors"
          title="View session history"
        >
          <History className="h-3.5 w-3.5" />
          History
        </Link>
      </div>

      {/* ── Tenant context banner (when session active) ────────────────────── */}
      {sessionInfo && (
        <div className="flex items-center gap-3 px-4 py-2 bg-orange-950/30 border-b border-orange-900/30">
          <div className="h-2 w-2 rounded-full bg-orange-400 animate-pulse flex-shrink-0" />
          <span className="text-xs text-orange-200 font-medium">
            {sessionInfo.banner}
          </span>
          <div className="flex-1" />
          <button
            onClick={disconnectSession}
            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300 transition-colors"
          >
            <X className="h-3 w-3" />
            Disconnect
          </button>
        </div>
      )}

      {/* ── Tenant selector (when no active session) ──────────────────────── */}
      {!sessionInfo && warningDismissed && (
        <div className="flex items-center gap-3 px-4 py-3 bg-[#161b22] border-b border-gray-800/60">
          <span className="text-xs text-gray-400 font-medium whitespace-nowrap">Select Tenant</span>
          <select
            value={selectedTenantId}
            onChange={(e) => setSelectedTenantId(e.target.value)}
            className="flex-1 max-w-xs text-xs bg-gray-800 border border-gray-700 text-gray-200 rounded-lg px-3 py-1.5 focus:outline-none focus:border-orange-500 transition-colors"
            id="tenant-selector"
          >
            <option value="">— Choose a tenant —</option>
            {tenants
              .filter((t) => t.status === "CONNECTED")
              .map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name} ({t.azureTenantId})
                </option>
              ))}
          </select>
          <button
            onClick={startSession}
            disabled={!selectedTenantId || wsStatus !== "authenticated"}
            className="flex items-center gap-1.5 text-xs font-medium px-4 py-1.5 rounded-lg bg-orange-600 hover:bg-orange-500 disabled:opacity-40 disabled:cursor-not-allowed text-white transition-colors"
          >
            Start Session
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          {wsStatus === "disconnected" && (
            <button
              onClick={connectWS}
              className="text-xs text-gray-500 hover:text-gray-300 underline transition-colors"
            >
              Reconnect
            </button>
          )}
        </div>
      )}

      {/* ── xterm.js terminal ─────────────────────────────────────────────── */}
      <div
        ref={terminalRef}
        className="flex-1 overflow-hidden"
        style={{ minHeight: 0 }}
        onMouseEnter={() => {
          // Init terminal when warning is dismissed and user mouses over the terminal area
          if (warningDismissed && !terminalReady) initTerminal();
        }}
      />

      {/* ── Placeholder before warning is dismissed ────────────────────────── */}
      {!warningDismissed && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <TerminalIcon className="h-16 w-16 text-gray-800 mx-auto mb-3" />
            <p className="text-gray-700 text-sm">Review the warning to open the terminal</p>
          </div>
        </div>
      )}
    </div>
  );
}
