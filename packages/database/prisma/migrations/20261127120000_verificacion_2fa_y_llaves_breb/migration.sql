-- Verificación en dos pasos: códigos de un solo uso enviados al correo (se guarda solo su huella).
CREATE TABLE "codigos_verificacion" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "proposito" TEXT NOT NULL,
    "codigo_hash" TEXT NOT NULL,
    "intentos" INTEGER NOT NULL DEFAULT 0,
    "expira_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "codigos_verificacion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "codigos_verificacion_user_id_proposito_idx" ON "codigos_verificacion"("user_id", "proposito");

ALTER TABLE "codigos_verificacion" ADD CONSTRAINT "codigos_verificacion_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Llaves Bre-B que el cliente guarda para cobrar con ellas más adelante.
CREATE TABLE "llaves_breb" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "valor" TEXT NOT NULL,
    "alias" TEXT,
    "estado" TEXT NOT NULL DEFAULT 'guardada',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llaves_breb_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "llaves_breb_user_id_tipo_valor_key" ON "llaves_breb"("user_id", "tipo", "valor");
CREATE INDEX "llaves_breb_user_id_idx" ON "llaves_breb"("user_id");

ALTER TABLE "llaves_breb" ADD CONSTRAINT "llaves_breb_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
