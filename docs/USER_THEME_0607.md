# TrendPay 0607 — Tema de usuario corregido

Esta versión actualiza la experiencia de usuario del frontend web para acercarla al diseño de la demo visual anterior:

- Sidebar completo de usuario: Inicio, Historial, Consignar, Cobrar QR, Enviar, Retirar a banco, Perfil, Referidos, Seguridad y Bancos.
- Dashboard con tarjeta de saldo grande, acciones rápidas, métricas y gráfica mensual.
- Modales estilo móvil para Consignar, Cobrar QR, Enviar y Retirar.
- Páginas de Historial, Perfil, Referidos, Seguridad y Bancos.
- Estilos encapsulados con clases `tp-*` en `globals.css` para no depender únicamente de Tailwind y evitar que el diseño se rompa si Tailwind no recompila.
- `next.config.js` simplificado para desarrollo local y con `chunkLoadTimeout` extendido para reducir errores de chunks en desarrollo.
- No se incluye `.next`, `.turbo`, `node_modules` ni archivos `.env` reales dentro del ZIP final.

## Cómo correr

```powershell
npm install
npm run dev
```

Abrir:

```text
http://localhost:3000
```

Si aparece caché vieja del navegador:

```text
Ctrl + Shift + R
```

## Archivos principales cambiados

```text
apps/web/src/app/dashboard/layout.tsx
apps/web/src/app/dashboard/page.tsx
apps/web/src/app/dashboard/historial/page.tsx
apps/web/src/app/dashboard/perfil/page.tsx
apps/web/src/app/dashboard/referidos/page.tsx
apps/web/src/app/dashboard/seguridad/page.tsx
apps/web/src/app/dashboard/bancos/page.tsx
apps/web/src/app/dashboard/consignar/page.tsx
apps/web/src/app/dashboard/cobrar-qr/page.tsx
apps/web/src/app/dashboard/enviar/page.tsx
apps/web/src/app/dashboard/retirar-banco/page.tsx
apps/web/src/components/user/UserTheme.tsx
apps/web/src/app/globals.css
apps/web/next.config.js
```
