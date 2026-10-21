-- AlterTable
ALTER TABLE "withdrawals" ADD COLUMN     "payout_ticket" TEXT,
ADD COLUMN     "payout_reference" TEXT;

-- CreateIndex
CREATE INDEX "withdrawals_payout_ticket_idx" ON "withdrawals"("payout_ticket");
