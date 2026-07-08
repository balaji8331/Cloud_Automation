/**
 * Terminal Adapter interface.
 * Any execution backend (local process, Docker, ACI) implements this shape.
 */
import type { Duplex } from "stream";

export interface SpawnResult {
  /** Unique identifier for this execution (process PID, container ID, ACI name, etc.) */
  executionId: string;
  /** Bidirectional stream — write sends input to shell, read receives output */
  stream: Duplex;
  /** Optionally resize the terminal PTY */
  resize?: (cols: number, rows: number) => Promise<void>;
}

export interface TerminalAdapter {
  spawn(opts: SpawnOpts): Promise<SpawnResult>;
  destroy(executionId: string): Promise<void>;
}

export interface SpawnOpts {
  /** Env vars to inject into the shell process */
  env?: Record<string, string>;
  /** Initial command to run before handing control to the user */
  initCommand?: string;
  cols?: number;
  rows?: number;
}
