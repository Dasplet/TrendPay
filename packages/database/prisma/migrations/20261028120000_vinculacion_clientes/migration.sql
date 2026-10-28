-- CreateTable
CREATE TABLE "vinculaciones" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "razon_social" TEXT NOT NULL,
    "nit" TEXT,
    "contacto_nombre" TEXT NOT NULL,
    "contacto_correo" TEXT NOT NULL,
    "estado" TEXT NOT NULL DEFAULT 'invitada',
    "mensaje" TEXT,
    "expira_at" TIMESTAMP(3) NOT NULL,
    "enviada_at" TIMESTAMP(3),
    "decidida_at" TIMESTAMP(3),
    "creada_por" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vinculaciones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vinculacion_documentos" (
    "id" TEXT NOT NULL,
    "vinculacion_id" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "nombre_original" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "tamano" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "fecha_expedicion" DATE,
    "estado" TEXT NOT NULL DEFAULT 'pendiente',
    "motivo" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vinculacion_documentos_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "vinculaciones_token_hash_key" ON "vinculaciones"("token_hash");

-- CreateIndex
CREATE INDEX "vinculaciones_estado_created_at_idx" ON "vinculaciones"("estado", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "vinculacion_documentos_vinculacion_id_tipo_key" ON "vinculacion_documentos"("vinculacion_id", "tipo");

-- AddForeignKey
ALTER TABLE "vinculaciones" ADD CONSTRAINT "vinculaciones_creada_por_fkey" FOREIGN KEY ("creada_por") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vinculacion_documentos" ADD CONSTRAINT "vinculacion_documentos_vinculacion_id_fkey" FOREIGN KEY ("vinculacion_id") REFERENCES "vinculaciones"("id") ON DELETE CASCADE ON UPDATE CASCADE;
