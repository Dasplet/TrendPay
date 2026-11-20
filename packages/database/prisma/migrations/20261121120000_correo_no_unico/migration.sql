-- Varias cuentas pueden compartir el mismo correo: lo que identifica a una cuenta es la cédula.
-- DropIndex
DROP INDEX "users_correo_key";

-- CreateIndex
CREATE INDEX "users_correo_idx" ON "users"("correo");
