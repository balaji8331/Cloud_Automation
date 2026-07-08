/**
 * LocalProcessTerminalAdapter
 * ============================
 * Spawns an interactive bash shell as a child process using a PTY.
 * This replaces the Docker-based terminal adapter so the system works
 * without Docker installed, and forms the seam for ACI in the future.
 *
 * Uses node-pty for full PTY support (arrow keys, tab-complete, etc.).
 * Falls back gracefully if node-pty is unavailable.
 */
import { Duplex } from "stream";
import type { TerminalAdapter, SpawnResult, SpawnOpts } from "./types";

// node-pty provides a real pseudoterminal — use it when available
// We lazy-require so the app still boots if node-pty is not installed
// (it requires native binaries which must be compiled).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let ptyModule: any = null;
try {
  ptyModule = require("node-pty");
} catch {
  // node-pty not installed — we fall back to piped bash
  console.warn("[LocalTerminal] node-pty not available, falling back to piped bash");
}

/** Map of executionId → pty/process handle for cleanup */
const activeSessions = new Map<string, { destroy: () => void }>();

export class LocalProcessTerminalAdapter implements TerminalAdapter {
  async spawn(opts: SpawnOpts): Promise<SpawnResult> {
    const cols = opts.cols ?? 220;
    const rows = opts.rows ?? 50;
    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      TERM: "xterm-256color",
      ...(opts.env ?? {}),
    };

    if (ptyModule) {
      return this._spawnWithPty(opts, cols, rows, env);
    }
    return this._spawnFallback(opts, env);
  }

  private _spawnWithPty(
    opts: SpawnOpts,
    cols: number,
    rows: number,
    env: Record<string, string>
  ): SpawnResult {
    const shell = process.env.SHELL ?? "/bin/bash";
    const initCmd = opts.initCommand ? `${opts.initCommand} ; exec ${shell} -i` : `${shell} -i`;

    const pty = ptyModule.spawn(shell, ["-c", initCmd], {
      name: "xterm-256color",
      cols,
      rows,
      env,
    });

    const executionId = String(pty.pid);

    // Use a Duplex stream to separate read/write paths and prevent echo feedback
    const stream = new Duplex({
      read() {}, // Let pty.onData push to this stream
      write(chunk, encoding, callback) {
        try { pty.write(chunk.toString()); } catch { /* ignore if exited */ }
        callback();
      }
    });

    pty.onData((data: string) => {
      stream.push(data);
    });

    pty.onExit(() => {
      stream.push(null);
      activeSessions.delete(executionId);
    });

    activeSessions.set(executionId, { destroy: () => { try { pty.kill(); } catch {} } });

    return {
      executionId,
      stream,
      resize: async (c: number, r: number) => { pty.resize(c, r); },
    };
  }

  private _spawnFallback(opts: SpawnOpts, env: Record<string, string>): SpawnResult {
    const { spawn } = require("child_process");
    const shell = process.env.SHELL ?? "/bin/bash";
    const args = opts.initCommand ? ["-c", `${opts.initCommand} ; exec ${shell} -i`] : ["-i"];
    const child = spawn(shell, args, { env, stdio: ["pipe", "pipe", "pipe"] });
    const executionId = String(child.pid ?? Date.now());

    const stream = new Duplex({
      read() {},
      write(chunk, encoding, callback) {
        if (child.stdin && !child.killed) {
          try { child.stdin.write(chunk); } catch {}
        }
        callback();
      }
    });

    child.stdout.on("data", (d: Buffer) => stream.push(d));
    child.stderr.on("data", (d: Buffer) => stream.push(d));
    child.on("exit", () => { stream.push(null); activeSessions.delete(executionId); });
    activeSessions.set(executionId, { destroy: () => child.kill("SIGKILL") });
    return { executionId, stream };
  }

  async destroy(executionId: string): Promise<void> {
    const handle = activeSessions.get(executionId);
    if (handle) {
      handle.destroy();
      activeSessions.delete(executionId);
    }
  }
}
