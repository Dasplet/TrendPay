# TrendPay — Billetera Virtual

Monorepo con Next.js (web) + React Native (móvil) + Node.js/Express (API) + PostgreSQL (Prisma).

## Estructura

```
trendpay/
├── apps/
│   ├── web/          → Next.js 14 (web app + admin)
│   └── mobile/       → React Native / Expo (iOS + Android)
├── packages/
│   ├── api/          → Express API (TypeScript)
│   └── database/     → Prisma schema + migrations
└── turbo.json        → Turborepo config
```

## Requisitos

- Node.js 18+
- npm 9+
- PostgreSQL 15+

## Setup local (paso a paso)

### 1. Instalar PostgreSQL

Descarga de: https://postgresql.org/download/windows  
Durante la instalación:
- Puerto: 5432
- Usuario: postgres
- Contraseña: (anótala, la necesitas)

### 2. Clonar y configurar

```bash
git clone https://github.com/tu-usuario/trendpay.git
cd trendpay
npm install
```

### 3. Variables de entorno

```bash
cp .env.example .env
```

Edita `.env` con tus valores:

```env
DATABASE_URL="postgresql://postgres:TU_CONTRASEÑA@localhost:5432/trendpay"
JWT_SECRET="genera-un-string-aleatorio-de-64-chars"
JWT_REFRESH_SECRET="otro-string-aleatorio-diferente"
ENCRYPTION_KEY="exactamente-32-caracteres-aqui!!"
```

Para generar secrets seguros, corre en PowerShell:
```powershell
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

### 4. Crear la base de datos

```bash
# Crear base de datos y aplicar schema
npm run db:migrate

# Cargar datos de prueba (admin + usuario demo)
npm run db:seed
```

### 5. Iniciar en modo desarrollo

```bash
npm run dev
```

Esto inicia:
- API: http://localhost:3001
- Web: http://localhost:3000
- Health check: http://localhost:3001/health

### Credenciales de prueba

| Rol    | Cédula     | PIN  |
|--------|------------|------|
| Admin  | 1000000001 | 0000 |
| Usuario | 1023456789 | 1234 |

---

## Deploy a Railway

### 1. Instalar Railway CLI

```bash
npm install -g @railway/cli
railway login
```

### 2. Crear proyecto

```bash
railway init
railway add --database postgresql
```

### 3. Configurar variables de entorno en Railway

En el dashboard de Railway → Variables:

```
DATABASE_URL         → (Railway lo pone automático)
JWT_SECRET           → tu-secret-64-chars
JWT_REFRESH_SECRET   → otro-secret-diferente
ENCRYPTION_KEY       → exactamente-32-chars
NODE_ENV             → production
PORT                 → (Railway lo pone automático)
CORS_ORIGIN          → https://tu-dominio.com
```

### 4. Deploy

```bash
git push origin main
# GitHub Actions hace el deploy automáticamente
```

---

## Fases del proyecto

- [x] **Fase 1** — Framework local (ahora)
- [ ] **Fase 2** — Deploy Railway + dominio
- [ ] **Fase 3** — Auth biométrica (WebAuthn + Face ID)
- [ ] **Fase 4** — SonarQube + pruebas de seguridad
- [ ] **Fase 5** — Rapyd producción + entidad legal

---

## Comandos útiles

```bash
npm run dev           # Inicia todo en desarrollo
npm run build         # Build de producción
npm run db:migrate    # Aplica migraciones de DB
npm run db:seed       # Carga datos de prueba
npm run db:studio     # Abre Prisma Studio (GUI para la DB)
npm run lint          # Linting
npm run test          # Tests
```
