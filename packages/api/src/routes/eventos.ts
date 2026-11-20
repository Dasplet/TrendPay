import { Router, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import { authenticate } from '../middleware/auth';
import { conCuenta } from '../utils/cuentas';
import { registrarConexion, enviarLatido } from '../utils/eventos';

const router = Router();

// ══ GET /api/eventos ══
// Conexión abierta (Server-Sent Events) que avisa cada vez que cambia algo que esta persona puede ver, para que su pantalla
// se actualice al instante sin recargar. Los administradores reciben el aviso de todo; un cliente, solo de su empresa.
// El aviso no lleva datos (ver utils/eventos.ts). Se cierra cuando vence la sesión: el navegador renueva el acceso y se
// vuelve a conectar solo.
router.get('/', authenticate, conCuenta(), (req: Request, res: Response) => {
  const cuenta = req.cuenta!;
  const exp = (req.user as { exp?: number } | undefined)?.exp;

  res.status(200).set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // que ningún proxy retenga los avisos
  });
  res.flushHeaders();
  res.write('retry: 3000\n: conectado\n\n');

  const conexion = { id: randomUUID(), userId: req.user!.id, titularId: cuenta.titularId, admin: req.user!.rol === 'admin', res };
  const baja = registrarConexion(conexion);

  const latido = setInterval(() => enviarLatido(conexion), 20_000);
  // Al vencer el token la conexión se cierra: el navegador renueva el acceso y vuelve a conectar
  const vencimiento = exp ? setTimeout(() => res.end(), Math.max(1000, exp * 1000 - Date.now())) : null;

  const limpiar = () => { clearInterval(latido); if (vencimiento) clearTimeout(vencimiento); baja(); };
  req.on('close', limpiar);
  res.on('close', limpiar);
});

export default router;
