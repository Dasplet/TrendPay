-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "sede_id" TEXT;

-- AlterTable
ALTER TABLE "cobros_datafono" ADD COLUMN "reembolso_client_id" TEXT,
ADD COLUMN "reembolsado_at" TIMESTAMP(3),
ADD COLUMN "reembolsado_por" TEXT;

-- CreateIndex
CREATE INDEX "transactions_sede_id_idx" ON "transactions"("sede_id");

-- CreateIndex
CREATE UNIQUE INDEX "cobros_datafono_reembolso_client_id_key" ON "cobros_datafono"("reembolso_client_id");
