-- Las cuentas que se "eliminaron" con el sistema anterior solo se renombraban (cédula DEL-..., correo ...@eliminado.local,
-- nombre "Usuario eliminado") y seguían apareciendo en los listados y sumando saldo. Ahora una cuenta eliminada no existe
-- para el sistema: se marcan como eliminadas (no salen en ningún listado ni en las métricas) y se les borra cualquier dato
-- personal que haya quedado.
UPDATE "users"
SET "eliminado_at" = CURRENT_TIMESTAMP,
    "celular" = NULL,
    "ciudad" = NULL,
    "codigo_referido" = NULL,
    "pin_hash" = '!eliminado',
    "bloqueado" = true,
    "eliminacion_programada_at" = NULL
WHERE "correo" LIKE '%@eliminado.local'
  AND "eliminado_at" IS NULL;

-- Sus sesiones ya no sirven
DELETE FROM "sessions"
WHERE "user_id" IN (SELECT "id" FROM "users" WHERE "eliminado_at" IS NOT NULL);
