-- AlterTable
ALTER TABLE "users" ADD COLUMN     "eliminacion_programada_at" TIMESTAMP(3),
ADD COLUMN     "eliminado_at" TIMESTAMP(3);

-- Todas las sedes (cuentas hijo) tienen el mismo formato que la "hijo 1": no ven el saldo y solo recargan/cobran;
-- no envían ni retiran.
UPDATE "users"
SET "permiso_ver_saldo" = false,
    "permiso_recargar"  = true,
    "permiso_enviar"    = false,
    "permiso_retirar"   = false
WHERE "cuenta_padre_id" IS NOT NULL;
