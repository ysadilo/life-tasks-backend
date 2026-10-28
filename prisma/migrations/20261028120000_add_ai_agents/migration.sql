-- CreateEnum
CREATE TYPE "AgentPermission" AS ENUM ('read', 'add', 'edit', 'done', 'triage', 'delete');

-- CreateEnum
CREATE TYPE "AgentActionKind" AS ENUM ('read', 'added', 'edited', 'moved', 'done', 'triaged', 'deleted');

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "completedVia" TEXT,
ADD COLUMN     "createdVia" TEXT;

-- CreateTable
CREATE TABLE "AgentConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "permissions" "AgentPermission"[] DEFAULT ARRAY['read', 'add']::"AgentPermission"[],
    "boardIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentAction" (
    "id" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "kind" "AgentActionKind" NOT NULL,
    "boardId" TEXT,
    "taskId" TEXT,
    "taskTitle" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentConnection_userId_clientId_key" ON "AgentConnection"("userId", "clientId");

-- CreateIndex
CREATE INDEX "AgentAction_connectionId_createdAt_idx" ON "AgentAction"("connectionId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentConnection" ADD CONSTRAINT "AgentConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentAction" ADD CONSTRAINT "AgentAction_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "AgentConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

