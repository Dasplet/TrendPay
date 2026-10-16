-- AlterTable
ALTER TABLE "users" ADD COLUMN     "cuenta_padre_id" TEXT,
ADD COLUMN     "permiso_enviar" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "permiso_recargar" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "permiso_retirar" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "permiso_ver_saldo" BOOLEAN NOT NULL DEFAULT true;

-- CreateIndex
CREATE INDEX "users_cuenta_padre_id_idx" ON "users"("cuenta_padre_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_cuenta_padre_id_fkey" FOREIGN KEY ("cuenta_padre_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
