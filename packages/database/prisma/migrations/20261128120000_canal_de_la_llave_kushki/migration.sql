-- Una llave de Kushki puede ser de datáfonos (card present) o de la página web (pagos en línea).
ALTER TABLE "comercios_kushki_one" ADD COLUMN "canal" TEXT NOT NULL DEFAULT 'datafono';
