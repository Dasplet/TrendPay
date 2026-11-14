-- CreateTable
CREATE TABLE "comercios_kushki" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "public_merchant_id" TEXT NOT NULL,
    "private_merchant_id_cifrado" TEXT NOT NULL,
    "ambiente" TEXT NOT NULL DEFAULT 'produccion',
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comercios_kushki_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "kushki_payments" ADD COLUMN "comercio_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "comercios_kushki_user_id_key" ON "comercios_kushki"("user_id");

-- CreateIndex
CREATE INDEX "kushki_payments_comercio_id_idx" ON "kushki_payments"("comercio_id");

-- AddForeignKey
ALTER TABLE "comercios_kushki" ADD CONSTRAINT "comercios_kushki_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kushki_payments" ADD CONSTRAINT "kushki_payments_comercio_id_fkey" FOREIGN KEY ("comercio_id") REFERENCES "comercios_kushki"("id") ON DELETE SET NULL ON UPDATE CASCADE;
