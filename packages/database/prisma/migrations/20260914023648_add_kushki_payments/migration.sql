-- CreateTable
CREATE TABLE "kushki_payments" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "metodo" TEXT NOT NULL,
    "ticket_number" TEXT,
    "monto" DECIMAL(18,2) NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "kushki_payments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kushki_payments_reference_key" ON "kushki_payments"("reference");

-- CreateIndex
CREATE UNIQUE INDEX "kushki_payments_ticket_number_key" ON "kushki_payments"("ticket_number");

-- AddForeignKey
ALTER TABLE "kushki_payments" ADD CONSTRAINT "kushki_payments_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
