import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { logger } from './utils/logger';
import { apiLimiter } from './middleware/rateLimiter';
import { errorHandler } from './middleware/errorHandler';

// Routes
import authRouter      from './routes/auth';
import walletRouter    from './routes/wallet';
import usersRouter     from './routes/users';
import banksRouter     from './routes/banks';
import withdrawalsRouter from './routes/withdrawals';
import referralsRouter from './routes/referrals';
import adminRouter     from './routes/admin';
import userAuditRouter from './routes/userAudit';
import rapydRouter     from './routes/rapyd';
import bankAccountsRouter from './routes/bankAccounts';

export const prisma = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error'] : ['error'],
});

const app = express();
const PORT = parseInt(process.env.PORT || '3001', 10);

// ── Security headers ──
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production',
  crossOriginEmbedderPolicy: false,
}));

// ── CORS ──
const allowedOrigins = (
  process.env.CORS_ORIGIN ||
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5500,http://127.0.0.1:5500,null'
)
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

const allowNullOrigin =
  process.env.NODE_ENV !== 'production' ||
  process.env.ALLOW_NULL_ORIGIN === 'true' ||
  allowedOrigins.includes('null');

app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (origin === 'null' && allowNullOrigin) return callback(null, true);
    if (process.env.NODE_ENV !== 'production' && allowedOrigins.includes('*')) {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) return callback(null, true);

    logger.warn('CORS bloqueado', { origin, allowedOrigins });
    return callback(new Error(`CORS: origen no permitido — ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 86400,
}));

// ── Compression ──
app.use(compression());

// ── Rapyd webhook: debe montarse ANTES del body parser global ──
// Rapyd firma el body crudo; si express.json() lo parsea primero, la
// verificación de firma en /api/rapyd/webhook nunca coincide.
app.use('/api/rapyd', rapydRouter);

// ── Body parsing ──
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));
app.use(cookieParser());

// ── HTTP logging ──
if (process.env.NODE_ENV !== 'test') {
  app.use(morgan('combined', {
    stream: { write: (msg: string) => logger.http(msg.trim()) },
    skip: (req) => req.path === '/health',
  }));
}

// ── Rate limiting ──
app.use('/api/', apiLimiter);

// ── Trust proxy (Railway/Render) ──
app.set('trust proxy', 1);

// ── API Routes ──
app.use('/api/auth',        authRouter);
app.use('/api/wallet',      walletRouter);
app.use('/api/users',       usersRouter);
app.use('/api/banks',       banksRouter);
app.use('/api/withdrawals', withdrawalsRouter);
app.use('/api/bank-accounts', bankAccountsRouter);
app.use('/api/referrals',   referralsRouter);
app.use('/api/admin',       adminRouter);
app.use('/api/user-audit',  userAuditRouter);
// /api/rapyd se monta más arriba, antes del body parser (ver nota del webhook)

// ── Serve frontend static files ──
const publicPath = path.join(__dirname, '../../web/dist');
const fs = require('fs');
if (fs.existsSync(publicPath)) {
  app.use(express.static(publicPath));
  app.get('*', (req, res) => {
    if (!req.path.startsWith('/api')) {
      res.sendFile(path.join(publicPath, 'index.html'));
    }
  });
}

// ── Health check ──
app.get('/health', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status: 'ok',
      db: 'connected',
      env: process.env.NODE_ENV,
      timestamp: new Date().toISOString(),
    });
  } catch {
    res.status(503).json({ status: 'error', db: 'disconnected' });
  }
});

// ── 404 ──
app.use((req, res) => {
  res.status(404).json({ ok: false, mensaje: `Ruta ${req.method} ${req.path} no encontrada` });
});

// ── Error handler ──
app.use(errorHandler);

// ── Start ──
async function start() {
  try {
    await prisma.$connect();
    logger.info('✅ PostgreSQL conectado via Prisma');

    app.listen(PORT, '0.0.0.0', () => {
      logger.info(`🚀 TrendPay API corriendo en http://localhost:${PORT}`);
      logger.info(`🏥 Health check: http://localhost:${PORT}/health`);
    });
  } catch (err: any) {
    logger.error('❌ No se pudo iniciar el servidor', { err: err.message });
    process.exit(1);
  }
}

process.on('SIGTERM', async () => {
  logger.info('SIGTERM recibido — cerrando servidor');
  await prisma.$disconnect();
  process.exit(0);
});

process.on('unhandledRejection', (reason) => {
  logger.error('UnhandledRejection', { reason: String(reason) });
});

process.on('uncaughtException', (err: Error) => {
  logger.error('UncaughtException', { err: err.message });
  process.exit(1);
});

// En tests, supertest maneja el ciclo de vida del server directamente
// contra `app` — no necesitamos (ni queremos) un listen() real en un puerto fijo.
if (process.env.NODE_ENV !== 'test') {
  start();
}
export default app;
