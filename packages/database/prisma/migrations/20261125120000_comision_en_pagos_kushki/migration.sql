-- La comisión general ahora la fija el administrador. Cada consignación guarda la comisión con la que se cobró, para que cambiar
-- la cifra mientras un pago está pendiente no altere lo que se registra al acreditarlo. Los pagos existentes se cobraron al 3%.
ALTER TABLE "kushki_payments" ADD COLUMN "comision_pct" DECIMAL(5,2) NOT NULL DEFAULT 3;
