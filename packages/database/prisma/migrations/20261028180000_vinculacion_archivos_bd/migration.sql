-- CreateTable
CREATE TABLE "vinculacion_archivos" (
    "key" TEXT NOT NULL,
    "contenido" BYTEA NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vinculacion_archivos_pkey" PRIMARY KEY ("key")
);
