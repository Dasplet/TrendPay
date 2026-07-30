/*
  Warnings:

  - You are about to drop the `wompi_payments` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "wompi_payments" DROP CONSTRAINT "wompi_payments_user_id_fkey";

-- DropTable
DROP TABLE "wompi_payments";

-- CreateTable
CREATE TABLE "rapyd_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "checkout_id" TEXT,
    "monto" DECIMAL(18,2) NOT NULL,
    "rapyd_payment_id" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rapyd_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rapyd_payments_reference_key" ON "rapyd_payments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "rapyd_payments_checkout_id_key" ON "rapyd_payments"("checkout_id");

-- AddForeignKey
ALTER TABLE "rapyd_payments" ADD CONSTRAINT "rapyd_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
