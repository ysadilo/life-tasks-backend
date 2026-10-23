-- AlterTable
ALTER TABLE "Board" ADD COLUMN "shared" BOOLEAN NOT NULL DEFAULT false;

-- Owners become members so board access is a single membership check.
INSERT INTO "BoardMember" ("boardId", "userId", "role")
SELECT "id", "ownerId", 'owner' FROM "Board"
ON CONFLICT DO NOTHING;

-- CreateTable
CREATE TABLE "BoardInvite" (
    "id" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "invitedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BoardInvite_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BoardInvite_email_idx" ON "BoardInvite"("email");

-- CreateIndex
CREATE UNIQUE INDEX "BoardInvite_boardId_email_key" ON "BoardInvite"("boardId", "email");

-- AddForeignKey
ALTER TABLE "BoardInvite" ADD CONSTRAINT "BoardInvite_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "Board"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BoardInvite" ADD CONSTRAINT "BoardInvite_invitedBy_fkey" FOREIGN KEY ("invitedBy") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
