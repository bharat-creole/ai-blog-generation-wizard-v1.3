-- CreateTable
CREATE TABLE "agent_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "threadId" VARCHAR(255) NOT NULL,
    "title" VARCHAR(500),
    "topic" VARCHAR(255),
    "status" VARCHAR(50) NOT NULL DEFAULT 'active',
    "messages" JSONB NOT NULL,
    "agentState" JSONB NOT NULL,
    "lastMessageAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "messageCount" INTEGER NOT NULL DEFAULT 0,
    "blogGenerated" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMPTZ(6),

    CONSTRAINT "agent_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_history_threadId_key" ON "agent_history"("threadId");

-- CreateIndex
CREATE INDEX "agent_history_userId_lastMessageAt_idx" ON "agent_history"("userId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "agent_history_threadId_idx" ON "agent_history"("threadId");

-- CreateIndex
CREATE INDEX "agent_history_status_idx" ON "agent_history"("status");

-- AddForeignKey
ALTER TABLE "agent_history" ADD CONSTRAINT "agent_history_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
