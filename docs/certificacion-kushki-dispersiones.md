# Certificación técnica Kushki — Dispersión de retiros por ACH (Transfer Out)

Estado al 22/10/2026. Kushki exige aprobar esta certificación técnica para entregar credenciales productivas de dispersión.
La guía de Kushki enumera 8 pautas; esta es la evaluación de cada una.

## Resumen

| # | Pauta de Kushki | Estado | Dónde está |
|---|---|---|---|
| 1 | Cálculos de impuestos correctos | Cumple | `iniciarDispersion` en `packages/api/src/utils/kushki.ts` |
| 2 | Mensajes en pantalla según las respuestas de Kushki | Cumple (parcial en la app del usuario, ver nota) | `mensajeKushki` y rutas de `withdrawals.ts` |
| 3 | Guardar y registrar todas las respuestas de Kushki | Cumple | columna `payout_respuestas` del retiro |
| 4 | No enviar email en el token si no se requiere comprobante | Cumple | el token no lleva email |
| 5 | Responder 200 a los webhooks | No aplica hoy | no usamos webhook (ver nota) |
| 6 | Botón de pago deshabilitado tras el primer clic | Cumple | panel admin, app del usuario y servidor |
| 7 | Logo de Kushki visible para el cliente | **Pendiente** | falta el archivo del logo |
| 8 | Enviar todos los campos requeridos de la referencia API | Cumple en UAT | `iniciarDispersion` |

## Detalle

1. **Impuestos.** El retiro no cobra comisión ni IVA. Se envía `amount: { subtotalIva: 0, subtotalIva0: <monto>, iva: 0 }`.
   Confirmar con contabilidad que los retiros no causan IVA.
2. **Mensajes.** Los errores de Kushki se traducen a español (`PT001` datos de cuenta inválidos, 401/403 credenciales o dispersión no habilitada, banco no soportado, sin respuesta). El administrador ve el estado real al consultar un retiro (`APPROVAL`, `DECLINED`) y el usuario recibe una notificación cuando se envía o se rechaza su retiro.
   *Nota:* el historial del usuario aún muestra "Pendiente" mientras el banco confirma; no distingue "en proceso".
3. **Respuestas guardadas.** Cada retiro conserva, en orden, la respuesta del `init`, cada consulta de estado y cada error (etapa, fecha, contenido). Nunca se sobrescriben. El token de un solo uso, el número de cuenta y la cédula no se guardan ahí.
4. **Email.** La petición de token no incluye `email`.
5. **Webhook.** El estado se consulta cada 5 minutos con la conciliación. Si Kushki activa el webhook para el comercio habrá que crear un endpoint que responda `200`; hoy no existe, y no es necesario para operar.
6. **Doble clic.** Los botones se deshabilitan mientras la petición está en curso, y el servidor reclama el retiro con una actualización condicional antes de llamar a Kushki, de modo que dos clics no envían el dinero dos veces.
7. **Logo.** Descargar el logo desde el enlace de la guía de Kushki, guardarlo en `apps/web/public/kushki-logo.png` y mostrarlo en la pantalla de retiro.
8. **Campos.** Token: `documentType`, `documentNumber`, `accountType` (`CA` ahorros / `CC` corriente), `accountNumber`, `bankId`, `totalAmount`, `currency`. Init: `token` y `amount`. Para ACH no se envía `name`. Validado en UAT; falta contrastar con la referencia API de Kushki durante la revisión.

## Evidencia en UAT (ambiente de pruebas, 21/10/2026)

| Caso | Documento de prueba | Ticket | Estado devuelto |
|---|---|---|---|
| Aprobada | 123456789 | 1792588260045580 | APPROVAL |
| Aprobada | 123456789 | 1792588592918608 | APPROVAL |
| Aprobada | 123456789 | 1792618152194679 | APPROVAL |
| Aprobada | 111111111 | 1792618014095247 | APPROVAL |
| Aprobada | 1023456789 | 1792618021472926 | APPROVAL |
| Declinada | 999999990 | 1792588264107302 | DECLINED |
| Declinada | 999999990 | 1792601702570803 | DECLINED |

No se logró un caso "en espera" en UAT: el sandbox resuelve al instante. El código trata cualquier estado distinto de `APPROVAL` o `DECLINED` como pendiente y vuelve a consultarlo.

## Pasos para pasar a producción

1. Pedir a Kushki: habilitar dispersión en el comercio de producción, informar cómo fondear el saldo, tarifas por dispersión, si se reintegra el monto al saldo cuando el banco rechaza (en UAT el saldo no volvió), y si requieren afiliación o aprobación de riesgo.
2. Cerrar la pauta 7 (logo).
3. Entregar a Kushki la evidencia de esta lista y los tickets de prueba.
4. Con las credenciales productivas, configurar en Railway: `KUSHKI_BASE_URL`, `KUSHKI_PUBLIC_MERCHANT_ID`, `KUSHKI_PRIVATE_MERCHANT_ID` y por último `KUSHKI_PAYOUTS_ENABLED=true`.
5. Hacer un primer retiro real de monto bajo y verificar el ticket con "Consultar en Kushki" en el historial de retiros del panel admin.

## Limitaciones conocidas

- Nubank no figura en la lista de bancos de dispersión de Kushki: esos retiros se transfieren a mano con "Ya lo transferí a mano".
- Se asume cédula (CC) como tipo de documento del titular.
- Bre-B (llaves) no está implementado ni probado; esta certificación cubre solo ACH.
