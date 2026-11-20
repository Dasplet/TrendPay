-- Ventas hechas directamente en el datáfono (el cajero digita el valor en el aparato): Kushki avisa cada venta y reembolso por webhook.

-- La firma de los webhooks de card present (Consola Kushki > Desarrolladores > Webhooks) se guarda por empresa, cifrada.
-- El Business-Code deja de ser obligatorio: solo hace falta para mandar órdenes al aparato desde TrendPay (ya no se usa).
ALTER TABLE "comercios_kushki_one" ALTER COLUMN "business_code_cifrado" DROP NOT NULL;
ALTER TABLE "comercios_kushki_one" ADD COLUMN "webhook_secret_cifrado" TEXT;

-- Cada movimiento de datáfono guarda de dónde viene y si es una venta o un reembolso.
ALTER TABLE "cobros_datafono" ADD COLUMN "origen" TEXT NOT NULL DEFAULT 'trendpay',
ADD COLUMN "tipo" TEXT NOT NULL DEFAULT 'cobro',
ADD COLUMN "reembolso_de_id" TEXT;

CREATE INDEX "cobros_datafono_origen_idx" ON "cobros_datafono"("origen");
