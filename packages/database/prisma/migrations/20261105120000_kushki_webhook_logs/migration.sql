-- CreateTable
CREATE TABLE "kushki_webhook_logs" (
    "id" TEXT NOT NULL,
    "ticket" TEXT,
    "firma_valida" BOOLEAN NOT NULL,
    "estado_http" INTEGER NOT NULL,
    "detalle" TEXT,
    "ip" TEXT,
    "cabeceras" JSONB,
    "cuerpo" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kushki_webhook_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kushki_webhook_logs_created_at_idx" ON "kushki_webhook_logs"("created_at" DESC);
