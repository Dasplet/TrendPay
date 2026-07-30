# Corrección comandos usuario 0607

Esta versión corrige tres puntos del tema de usuario:

1. **Foto de perfil**
   - En `Mi perfil`, el botón de cámara abre el selector de imagen.
   - La foto se guarda en el estado persistido del navegador (`localStorage`) y se refleja en sidebar, topbar y perfil.
   - Se permite quitar la foto desde `Mi perfil`.
   - Límite de imagen: 2 MB.

2. **Notificaciones desde la campanita**
   - La campanita usa íconos de `lucide-react`, no emojis.
   - Abre un panel desplegable con notificaciones reales del backend.
   - Permite marcar como leídas, eliminar una notificación o eliminar todas.
   - Endpoints agregados:
     - `GET /api/users/notifications`
     - `PUT /api/users/notifications/read`
     - `DELETE /api/users/notifications/:id`
     - `DELETE /api/users/notifications`

3. **Usuarios creados visibles en admin**
   - Se implementó `GET /api/admin/users` usando Prisma.
   - El panel admin ahora consulta usuarios reales de PostgreSQL.
   - También se agregaron endpoints mínimos para actualizar/eliminar usuarios y consultar métricas/transacciones.

## Aplicación rápida

```powershell
cd "C:\Users\USUARIO MC\Desktop\Trendpay"

taskkill /F /IM node.exe
Remove-Item -Recurse -Force .\themefix -ErrorAction SilentlyContinue
Expand-Archive .\Trendpay-0607-user-commands-fixed.zip -DestinationPath .\themefix -Force
robocopy .\themefix\Trendpay-0607-user-commands-fixed .\Trendpay-0307 /E /XD node_modules .next .turbo /XF .env

cd .\Trendpay-0307
Get-ChildItem -Recurse -Directory -Filter ".next" | Remove-Item -Recurse -Force
Get-ChildItem -Recurse -Directory -Filter ".turbo" | Remove-Item -Recurse -Force
npm install
npm run dev
```
