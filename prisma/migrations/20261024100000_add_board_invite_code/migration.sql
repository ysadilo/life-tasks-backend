-- AlterTable
ALTER TABLE "Board" ADD COLUMN "inviteCode" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "Board_inviteCode_key" ON "Board"("inviteCode");
