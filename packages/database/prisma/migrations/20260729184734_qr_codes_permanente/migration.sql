-- AlterTable
ALTER TABLE "qr_codes" ADD COLUMN     "permanente" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE INDEX "qr_codes_wallet_id_permanente_idx" ON "qr_codes"("wallet_id", "permanente");
