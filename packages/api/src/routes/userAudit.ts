import { Router } from 'express';
// TODO: migrate from trendpay-backend/src/routes/userAudit.js
// Full implementation in packages/api/src/routes/userAudit.ts
const router = Router();
router.get('/', (_req, res) => res.json({ ok: true, mensaje: 'userAudit route - coming soon' }));
export default router;
