/**
 * Unified Background Worker
 * ==========================
 * Runs as a standalone process: `npm run worker`
 *
 * Responsibilities:
 *  1. Job queue polling (cost ingestion, budget alerts, anomaly detection, resource sync)
 *  2. Automation poller (deletion schedule lifecycle)
 *  3. WebSocket terminal server (Super Admin CLI) — replaces terminal-server/server.js
 *
 * The Next.js web process should NOT run any background tasks.
 * The instrumentation.ts file is a no-op stub after this migration.
 */

// Environment is loaded by tsx via --env-file flag (see package.json worker script)

// ─── Bootstrap ───────────────────────────────────────────────────────────────

async function main() {
  console.log("[Worker] Starting unified background worker…");

  // 1. Start the job queue scheduler (daily cron + queue worker + automation poller)
  const { startScheduler } = await import("../jobs/scheduler");
  startScheduler();
  console.log("[Worker] Scheduler started");

  // 2. Start the WebSocket terminal server
  await startTerminalServer();
  console.log("[Worker] All services started");
}

// ─── Terminal WebSocket Server ────────────────────────────────────────────────

async function startTerminalServer() {
  const { WebSocketServer } = await import("ws");
  const http = await import("http");
  const crypto = await import("crypto");
  const { PrismaClient } = await import("@prisma/client");
  const { LocalProcessTerminalAdapter } = await import("../lib/terminal/local");
  const { decryptJson, decrypt } = await import("../lib/crypto");

  const prisma = new PrismaClient();
  const adapter = new LocalProcessTerminalAdapter();

  const PORT = parseInt(process.env.TERMINAL_WS_PORT ?? "3001", 10);
  const IDLE_TIMEOUT_MS = parseInt(
    process.env.TERMINAL_IDLE_TIMEOUT_MS ?? String(15 * 60 * 1000),
    10
  );
  const MAX_SESSION_MS = parseInt(
    process.env.TERMINAL_MAX_SESSION_MS ?? String(2 * 60 * 60 * 1000),
    10
  );
  const NEXTAUTH_URL = process.env.NEXTAUTH_URL ?? "http://localhost:3000";

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function validateSuperAdmin(req: import("http").IncomingMessage) {
    try {
      const cookieHeader = req.headers.cookie ?? "";
      if (!cookieHeader) return null;
      const response = await fetch(`${NEXTAUTH_URL}/api/auth/session`, {
        headers: { cookie: cookieHeader },
      });
      if (!response.ok) return null;
      const session = await response.json() as { user?: { id: string; email: string; role: string } };
      if (!session?.user?.id || session.user.role !== "SUPER_ADMIN") return null;
      return session.user;
    } catch (err) {
      console.error("[Auth] session validation error:", (err as Error).message);
      return null;
    }
  }

  // ── HTTP + WebSocket server ────────────────────────────────────────────────

  const server = http.createServer((req, res) => {
    if (req.url === "/health") {
      res.writeHead(200);
      res.end("ok");
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const wss = new WebSocketServer({ server });

  wss.on("connection", async (ws, req) => {
    const clientIp =
      (req.headers["x-forwarded-for"] as string) ?? req.socket.remoteAddress ?? "unknown";
    console.log(`[WS] New connection from ${clientIp}`);

    // 1. Authenticate
    const user = await validateSuperAdmin(req);
    if (!user) {
      ws.send(JSON.stringify({ type: "error", message: "Unauthorized: SUPER_ADMIN required" }));
      ws.close(4001, "Unauthorized");
      return;
    }

    console.log(`[WS] Authenticated: ${user.email}`);
    ws.send(JSON.stringify({ type: "authenticated", userId: user.id }));
    ws.send(JSON.stringify({ type: "info", message: "Select a tenant to begin your session." }));

    // Session state
    let sessionRecord: { id: string; startedAt: Date; tenantId: string } | null = null;
    let executionId: string | null = null;
    let spawnResult: import("../lib/terminal/types").SpawnResult | null = null;
    let idleTimer: ReturnType<typeof setTimeout> | null = null;
    let maxTimer: ReturnType<typeof setTimeout> | null = null;
    let commandBuffer = "";

    // Cleanup
    async function cleanup(reason = "user_disconnect") {
      if (idleTimer) clearTimeout(idleTimer);
      if (maxTimer) clearTimeout(maxTimer);

      if (spawnResult) {
        try { spawnResult.stream.destroy(); } catch {}
        spawnResult = null;
      }
      if (executionId) {
        try { await adapter.destroy(executionId); } catch {}
        executionId = null;
      }

      if (sessionRecord) {
        await prisma.terminalSession.update({
          where: { id: sessionRecord.id },
          data: { status: "ENDED", endedAt: new Date(), endReason: reason, executionId: null },
        }).catch(() => {});

        const duration = Math.round((Date.now() - sessionRecord.startedAt.getTime()) / 1000);
        await prisma.auditLog.create({
          data: {
            userId: user!.id,
            action: "TERMINAL_SESSION_END",
            resourceType: "terminal_session",
            resourceId: sessionRecord.id,
            ipAddress: clientIp,
            metadata: { reason, durationSeconds: duration, tenantId: sessionRecord.tenantId },
          },
        }).catch(() => {});

        sessionRecord = null;
      }
    }

    function resetIdleTimer() {
      if (idleTimer) clearTimeout(idleTimer);
      idleTimer = setTimeout(async () => {
        ws.send(JSON.stringify({ type: "error", message: "Session terminated: idle timeout (15 min)" }));
        await cleanup("idle_timeout");
        ws.close(4002, "Idle timeout");
      }, IDLE_TIMEOUT_MS);
    }

    // 2. Message handler
    ws.on("message", async (raw) => {
      let msg: { type: string; tenantId?: string; cols?: number; rows?: number };
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        // Raw terminal input — pipe directly to the shell
        if (spawnResult) {
          resetIdleTimer();
          const text = raw.toString();
          commandBuffer += text;

          if (text.includes("\r") || text.includes("\n")) {
            const command = commandBuffer.replace(/[\r\n]+$/, "").trim();
            if (command && sessionRecord) {
              await prisma.terminalCommand.create({
                data: { sessionId: sessionRecord.id, commandText: command },
              }).catch(() => {});
            }
            commandBuffer = "";
          }

          spawnResult.stream.write(raw as Buffer);
        }
        return;
      }

      if (msg.type === "select_tenant") {
        if (sessionRecord) {
          ws.send(JSON.stringify({ type: "error", message: "Session already active" }));
          return;
        }

        const { tenantId } = msg;
        if (!tenantId) {
          ws.send(JSON.stringify({ type: "error", message: "tenantId is required" }));
          return;
        }

        ws.send(JSON.stringify({ type: "info", message: "Initializing secure shell session…" }));

        try {
          // Load tenant + credentials via CloudCredential
          const tenant = await prisma.tenant.findUnique({
            where: { id: tenantId },
            select: {
              id: true,
              name: true,
              subscriptions: { select: { subscriptionId: true, subscriptionName: true } },
              cloudCredential: { select: { credentialData: true } },
            },
          });

          if (!tenant || !tenant.cloudCredential) {
            ws.send(JSON.stringify({ type: "error", message: "Tenant not found or no credentials configured" }));
            return;
          }

          // Decrypt Azure credentials
          const rawCreds = decryptJson<{
            azureTenantId: string;
            clientId: string;
            clientSecretEnc: string;
          }>(tenant.cloudCredential.credentialData);

          const azureTenantId = rawCreds.azureTenantId;
          const clientId = rawCreds.clientId;
          const clientSecret = decrypt(rawCreds.clientSecretEnc);

          // Create DB session record
          sessionRecord = await prisma.terminalSession.create({
            data: {
              userId: user.id,
              tenantId: tenant.id,
              status: "ACTIVE",
              ipAddress: clientIp,
            },
          });

          await prisma.auditLog.create({
            data: {
              userId: user.id,
              action: "TERMINAL_SESSION_START",
              resourceType: "terminal_session",
              resourceId: sessionRecord.id,
              ipAddress: clientIp,
              metadata: { tenantId: tenant.id, tenantName: tenant.name },
            },
          }).catch(() => {});

          // Spawn local bash with az login
          const initCommand = `az login --service-principal -u "$AZURE_CLIENT_ID" -p "$AZURE_CLIENT_SECRET" --tenant "$AZURE_TENANT_ID" --output none`;

          spawnResult = await adapter.spawn({
            env: {
              AZURE_TENANT_ID: azureTenantId,
              AZURE_CLIENT_ID: clientId,
              AZURE_CLIENT_SECRET: clientSecret,
            },
            initCommand,
          });

          executionId = spawnResult.executionId;

          // Persist executionId
          await prisma.terminalSession.update({
            where: { id: sessionRecord.id },
            data: { executionId },
          }).catch(() => {});

          // Pipe shell output → WS
          spawnResult.stream.on("data", (chunk: Buffer | string) => {
            if (ws.readyState === ws.OPEN) ws.send(chunk);
          });

          spawnResult.stream.on("end", async () => {
            ws.send(JSON.stringify({ type: "info", message: "Shell session ended." }));
            await cleanup("shell_exit");
            if (ws.readyState === ws.OPEN) ws.close(1000, "Shell exited");
          });

          const subList = tenant.subscriptions
            .map((s) => s.subscriptionName ?? s.subscriptionId)
            .join(", ");

          ws.send(JSON.stringify({
            type: "session_started",
            sessionId: sessionRecord.id,
            tenant: { id: tenant.id, name: tenant.name, subscriptions: tenant.subscriptions },
            banner: `Connected to: ${tenant.name} | Subscriptions: ${subList || "none"}`,
          }));

          resetIdleTimer();
          maxTimer = setTimeout(async () => {
            ws.send(JSON.stringify({ type: "error", message: "Session terminated: max duration (2 hours) reached" }));
            await cleanup("max_duration");
            ws.close(4003, "Max duration");
          }, MAX_SESSION_MS);

        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[Session] Failed to start:", err);
          ws.send(JSON.stringify({ type: "error", message: `Failed to start session: ${msg}` }));
          await cleanup("start_error");
        }

      } else if (msg.type === "resize") {
        if (spawnResult?.resize && msg.cols && msg.rows) {
          await spawnResult.resize(msg.cols, msg.rows).catch(() => {});
        }
      } else if (msg.type === "ping") {
        ws.send(JSON.stringify({ type: "pong" }));
      }
    });

    ws.on("close", async () => {
      console.log(`[WS] Disconnected: ${user.email}`);
      await cleanup("user_disconnect");
    });

    ws.on("error", async (err) => {
      console.error(`[WS] Error for ${user.email}:`, err.message);
      await cleanup("error");
    });
  });

  server.listen(PORT, () => {
    console.log(`[TerminalServer] Listening on ws://localhost:${PORT}`);
    console.log(`[TerminalServer] Idle: ${IDLE_TIMEOUT_MS / 60000}min | Max: ${MAX_SESSION_MS / 3600000}hr`);
  });

  // Graceful shutdown
  process.on("SIGTERM", async () => {
    console.log("[Worker] SIGTERM — shutting down");
    wss.close();
    await prisma.$disconnect();
    process.exit(0);
  });

  process.on("SIGINT", async () => {
    console.log("[Worker] SIGINT — shutting down");
    wss.close();
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error("[Worker] Fatal startup error:", err);
  process.exit(1);
});
