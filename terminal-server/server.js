/**
 * Azure Terminal WebSocket Sidecar Server
 * =========================================
 * Runs on port 3001 (configurable via TERMINAL_WS_PORT env).
 *
 * Flow:
 *  1. Browser opens WS to ws://localhost:3001
 *  2. Server validates NextAuth session cookie → checks SUPER_ADMIN role
 *  3. Client sends { type: "select_tenant", tenantId }
 *  4. Server decrypts tenant credentials, spins up isolated Docker container
 *  5. Container auto-logs-in via az login --service-principal
 *  6. stdin/stdout piped through WS
 *  7. Every command line logged to DB BEFORE being piped to container
 *  8. Idle timeout: 15 min | Hard max: 2 hours
 *  9. On disconnect/timeout: docker rm -f, session marked ENDED in DB
 */

"use strict";

require("dotenv").config({ path: require("path").resolve(__dirname, "../.env") });

const { WebSocketServer } = require("ws");
const Docker = require("dockerode");
const { PrismaClient } = require("../node_modules/@prisma/client");
const http = require("http");
const crypto = require("crypto");
const cookie = require("cookie");

const prisma = new PrismaClient();
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

const PORT = parseInt(process.env.TERMINAL_WS_PORT || "3001", 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.TERMINAL_IDLE_TIMEOUT_MS || String(15 * 60 * 1000), 10);  // 15 min
const MAX_SESSION_MS = parseInt(process.env.TERMINAL_MAX_SESSION_MS || String(2 * 60 * 60 * 1000), 10); // 2 hours
const AZURE_CLI_IMAGE = process.env.TERMINAL_DOCKER_IMAGE || "mcr.microsoft.com/azure-cli";

// ── Crypto helpers (matches lib/crypto/index.ts) ──────────────────────────────
const ALGORITHM = "aes-256-cbc";
const KEY = Buffer.from(process.env.SECRET_ENCRYPTION_KEY || "", "hex");

function decrypt(encryptedHex) {
  const [ivHex, encrypted] = encryptedHex.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  return decipher.update(encrypted, "hex", "utf8") + decipher.final("utf8");
}

// ── Session validation ────────────────────────────────────────────────────────
const NEXTAUTH_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

async function validateSuperAdmin(req) {
  try {
    const cookieHeader = req.headers.cookie || "";
    if (!cookieHeader) return null;

    // Forward the browser's cookies to Next.js's session endpoint.
    // This is the same check Next.js does internally — no JWT library needed.
    const response = await fetch(`${NEXTAUTH_URL}/api/auth/session`, {
      headers: { cookie: cookieHeader },
    });

    if (!response.ok) return null;

    const session = await response.json();

    // session is {} when unauthenticated
    if (!session?.user?.id || !session?.user?.role) return null;
    if (session.user.role !== "SUPER_ADMIN") return null;

    return session.user; // { id, email, name, role }
  } catch (err) {
    console.error("[Auth] session validation error:", err.message);
    return null;
  }
}

// ── Main WebSocket server ─────────────────────────────────────────────────────
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
  const clientIp = req.headers["x-forwarded-for"] || req.socket.remoteAddress;
  console.log(`[WS] New connection from ${clientIp}`);

  // ── 1. Authenticate ──────────────────────────────────────────────────────
  const user = await validateSuperAdmin(req);
  if (!user) {
    ws.send(JSON.stringify({ type: "error", message: "Unauthorized: SUPER_ADMIN required" }));
    ws.close(4001, "Unauthorized");
    return;
  }

  console.log(`[WS] Authenticated: ${user.email}`);
  ws.send(JSON.stringify({ type: "authenticated", userId: user.id }));
  ws.send(JSON.stringify({ type: "info", message: "Select a tenant to begin your session." }));

  // ── Session state ────────────────────────────────────────────────────────
  let sessionRecord = null;
  let container = null;
  let execStream = null;
  let idleTimer = null;
  let maxTimer = null;
  let lastInputAt = Date.now();
  let commandBuffer = "";

  // ── Cleanup on disconnect ────────────────────────────────────────────────
  async function cleanup(reason = "user_disconnect") {
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);

    if (execStream) {
      try { execStream.end(); } catch {}
      execStream = null;
    }

    if (container) {
      try {
        console.log(`[Docker] Destroying container ${container.id}`);
        await container.remove({ force: true });
      } catch (err) {
        console.error("[Docker] Failed to remove container:", err.message);
      }
      container = null;
    }

    if (sessionRecord) {
      await prisma.terminalSession.update({
        where: { id: sessionRecord.id },
        data: {
          status: "ENDED",
          endedAt: new Date(),
          endReason: reason,
          containerId: null,
        },
      });

      // Audit log
      const duration = Math.round((Date.now() - sessionRecord.startedAt.getTime()) / 1000);
      await prisma.auditLog.create({
        data: {
          userId: user.id,
          action: "TERMINAL_SESSION_END",
          resourceType: "terminal_session",
          resourceId: sessionRecord.id,
          ipAddress: String(clientIp),
          metadata: { reason, durationSeconds: duration, tenantId: sessionRecord.tenantId },
        },
      });

      sessionRecord = null;
    }
  }

  function resetIdleTimer() {
    clearTimeout(idleTimer);
    lastInputAt = Date.now();
    idleTimer = setTimeout(async () => {
      ws.send(JSON.stringify({ type: "error", message: "Session terminated: idle timeout (15 min)" }));
      await cleanup("idle_timeout");
      ws.close(4002, "Idle timeout");
    }, IDLE_TIMEOUT_MS);
  }

  // ── 2. Message handler ───────────────────────────────────────────────────
  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      // Raw terminal input (binary/text from xterm after session started)
      if (container && execStream) {
        resetIdleTimer();
        const text = raw.toString();
        commandBuffer += text;

        // Log complete commands (on Enter key)
        if (text.includes("\r") || text.includes("\n")) {
          const command = commandBuffer.replace(/[\r\n]+$/, "").trim();
          if (command && sessionRecord) {
            // Log BEFORE piping to container
            try {
              await prisma.terminalCommand.create({
                data: {
                  sessionId: sessionRecord.id,
                  commandText: command,
                },
              });
            } catch (err) {
              console.error("[DB] Failed to log command:", err.message);
            }
          }
          commandBuffer = "";
        }

        execStream.write(raw);
      }
      return;
    }

    // ── JSON protocol messages ─────────────────────────────────────────
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

      ws.send(JSON.stringify({ type: "info", message: "Initializing secure container…" }));

      try {
        // Fetch tenant credentials
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: {
            id: true,
            name: true,
            azureTenantId: true,
            clientId: true,
            clientSecretEnc: true,
            subscriptions: { select: { subscriptionId: true, subscriptionName: true } },
          },
        });

        if (!tenant) {
          ws.send(JSON.stringify({ type: "error", message: "Tenant not found" }));
          return;
        }

        // Decrypt secret in-memory — never written to disk or logged
        const clientSecret = decrypt(tenant.clientSecretEnc);

        // Create DB session record
        sessionRecord = await prisma.terminalSession.create({
          data: {
            userId: user.id,
            tenantId: tenant.id,
            status: "ACTIVE",
            ipAddress: String(clientIp),
          },
        });

        // Audit log: session start
        await prisma.auditLog.create({
          data: {
            userId: user.id,
            action: "TERMINAL_SESSION_START",
            resourceType: "terminal_session",
            resourceId: sessionRecord.id,
            ipAddress: String(clientIp),
            metadata: { tenantId: tenant.id, tenantName: tenant.name },
          },
        });

        // Build the auto-login command
        const loginCommand = [
          "sh", "-c",
          `az login --service-principal -u "${tenant.clientId}" -p "${clientSecret}" --tenant "${tenant.azureTenantId}" --output none && exec sh`
        ];

        // Spawn isolated Docker container
        container = await docker.createContainer({
          Image: AZURE_CLI_IMAGE,
          Cmd: loginCommand,
          Env: [
            `AZURE_TENANT_ID=${tenant.azureTenantId}`,
            `AZURE_CLIENT_ID=${tenant.clientId}`,
            `AZURE_CLIENT_SECRET=${clientSecret}`,
          ],
          AttachStdin: true,
          AttachStdout: true,
          AttachStderr: true,
          OpenStdin: true,
          Tty: true,
          // No volume mounts — isolated filesystem
          HostConfig: {
            AutoRemove: false, // we rm -f manually for reliability
            NetworkMode: "bridge", // default — can be tightened with custom network
            ReadonlyRootfs: false,
            // Resource limits
            Memory: 256 * 1024 * 1024, // 256 MB
            NanoCpus: 500000000,        // 0.5 CPU
          },
        });

        await container.start();

        // Update session with container ID
        await prisma.terminalSession.update({
          where: { id: sessionRecord.id },
          data: { containerId: container.id },
        });

        // Attach to container I/O
        execStream = await container.attach({
          stream: true,
          stdin: true,
          stdout: true,
          stderr: true,
          hijack: true,
        });

        // Pipe container output → WS
        execStream.on("data", (chunk) => {
          if (ws.readyState === ws.OPEN) {
            ws.send(chunk);
          }
        });

        execStream.on("end", async () => {
          ws.send(JSON.stringify({ type: "info", message: "Container session ended." }));
          await cleanup("container_exit");
          if (ws.readyState === ws.OPEN) ws.close(1000, "Container exited");
        });

        // Send context info to frontend
        const subList = tenant.subscriptions.map((s) => s.subscriptionName || s.subscriptionId).join(", ");
        ws.send(JSON.stringify({
          type: "session_started",
          sessionId: sessionRecord.id,
          tenant: {
            id: tenant.id,
            name: tenant.name,
            azureTenantId: tenant.azureTenantId,
            subscriptions: tenant.subscriptions,
          },
          banner: `Connected to: ${tenant.name} | Subscriptions: ${subList || "none"}`,
        }));

        // Start timers
        resetIdleTimer();
        maxTimer = setTimeout(async () => {
          ws.send(JSON.stringify({ type: "error", message: "Session terminated: max duration (2 hours) reached" }));
          await cleanup("max_duration");
          ws.close(4003, "Max duration");
        }, MAX_SESSION_MS);

      } catch (err) {
        console.error("[Session] Failed to start:", err);
        ws.send(JSON.stringify({ type: "error", message: `Failed to start session: ${err.message}` }));
        await cleanup("start_error");
      }

    } else if (msg.type === "resize") {
      // xterm.js sends resize events
      if (container && msg.cols && msg.rows) {
        try {
          await container.resize({ w: msg.cols, h: msg.rows });
        } catch {}
      }

    } else if (msg.type === "ping") {
      ws.send(JSON.stringify({ type: "pong" }));
    }
  });

  ws.on("close", async () => {
    console.log(`[WS] Connection closed for ${user.email}`);
    await cleanup("user_disconnect");
  });

  ws.on("error", async (err) => {
    console.error(`[WS] Error for ${user.email}:`, err.message);
    await cleanup("error");
  });
});

server.listen(PORT, () => {
  console.log(`[Terminal Server] Listening on ws://localhost:${PORT}`);
  console.log(`[Terminal Server] Idle timeout: ${IDLE_TIMEOUT_MS / 60000} min | Max session: ${MAX_SESSION_MS / 3600000} hr`);
});

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("[Terminal Server] Shutting down…");
  wss.close();
  await prisma.$disconnect();
  process.exit(0);
});
