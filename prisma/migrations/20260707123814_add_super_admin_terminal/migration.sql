-- CreateEnum
CREATE TYPE "TerminalSessionStatus" AS ENUM ('ACTIVE', 'ENDED', 'ERROR');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'SUPER_ADMIN';

-- CreateTable
CREATE TABLE "terminal_sessions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "containerId" TEXT,
    "status" "TerminalSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "endReason" TEXT,
    "ipAddress" TEXT,

    CONSTRAINT "terminal_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "terminal_commands" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "commandText" TEXT NOT NULL,
    "executedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_commands_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "terminal_sessions_userId_startedAt_idx" ON "terminal_sessions"("userId", "startedAt");

-- CreateIndex
CREATE INDEX "terminal_sessions_tenantId_startedAt_idx" ON "terminal_sessions"("tenantId", "startedAt");

-- CreateIndex
CREATE INDEX "terminal_commands_sessionId_executedAt_idx" ON "terminal_commands"("sessionId", "executedAt");

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_sessions" ADD CONSTRAINT "terminal_sessions_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "terminal_commands" ADD CONSTRAINT "terminal_commands_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "terminal_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
