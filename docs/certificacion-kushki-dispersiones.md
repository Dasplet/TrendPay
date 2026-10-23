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
| 5 | Responder 200 a los webhooks | Cumple (falta activarlo en Kushki) | `POST /api/kushki/webhooks/payout` |
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
5. **Webhook.** Endpoint `POST /api/kushki/webhooks/payout`. Verifica la firma de Kushki (`X-Kushki-Signature` o `X-Kushki-SimpleSignature`, HMAC SHA256 con el "webhook signature ID" de la consola) y rechaza con 401 lo que no esté firmado. Con una firma válida solo toma el `ticketNumber` del aviso y confirma el resultado consultando la API de Kushki antes de cerrar el retiro. Responde `200` si lo procesó, y error (404/500/503) si algo está pendiente para que Kushki reintente (hasta 7 veces en 3 horas). Es idempotente: un aviso duplicado no devuelve el saldo dos veces. Los datos bancarios del aviso (`accountNumber`, `documentNumber`) no se guardan. La conciliación cada 5 minutos sigue activa como respaldo.
   Para activarlo: configurar `KUSHKI_WEBHOOK_SECRET` en Railway con el signature ID, y registrar en la consola de Kushki (Desarrolladores > Webhooks) o por solicitud a Kushki la URL `https://<dominio-de-la-api>/api/kushki/webhooks/payout` para las notificaciones de Transfer Out. Kushki envía desde IPs fijas: UAT `54.208.105.247`, producción `34.230.185.20`.
   *No confirmado en la documentación:* si la firma viene en hex o base64 (se aceptan ambos), el tiempo máximo de respuesta y el orden de entrega de los avisos.
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
- Bre-B se certifica aparte (siguiente sección) y hoy no está implementado ni se puede probar en UAT.

---

# Certificación técnica Kushki — Bre-B (retiros a llaves)

Fuente: página "Disburse with Bre-B" de la documentación de Kushki Colombia (https://docs.kushki.com/co/en/payouts/transfer/breb). Es un producto **beta**: requiere que Kushki configure el procesador Bre-B en el comercio.

## Estado actual: bloqueado por habilitación

Prueba en UAT del 23/10/2026 con las llaves del sandbox de TrendPay:

| Prueba | Resultado |
|---|---|
| Token ACH (`CA`) de control | 201, funciona |
| Token Bre-B `KP` (celular de prueba `3001234567`) | 400 `PT001` "Cuerpo de la petición inválido" |
| Token Bre-B `KE` (correo de prueba), con o sin `name` o documento | 400 `PT001` |
| Endpoint `/payouts/transfer/v2/tokens` | No existe (403 "Missing Authentication Token"); solo existe la v2 de `bankList` |

La causa más probable es que el procesador Bre-B no está configurado en nuestro comercio. Hay que pedirle a Kushki (account manager) que lo habilite en UAT y en producción.

## Cómo funciona Bre-B según Kushki

- Mismos endpoints v1 que ACH (`tokens`, `init`, `transaction/{ticket}`).
- Token: obligatorios `accountType`, `accountNumber` (la llave), `totalAmount`, `currency`. No lleva `bankId` ni documento. Tipos de llave: `KI` identificación, `KP` celular (10 dígitos, empieza por 3), `KE` correo, `KA` alias (empieza por `@`), `KM` código de comercio (10 dígitos, empieza por 00).
- El token devuelve `keyResolution` con `keyValue` y `ownerName` (enmascarado en producción). **Se debe mostrar al usuario y obtener su confirmación explícita antes de iniciar el envío.**
- Tiempo: tiempo real, máximo 30 segundos. Mínimo 1 COP, máximo 1.000 UVT por transacción.
- El saldo de dispersión se descuenta al iniciar el envío.
- Errores propios: `PT060` (llave inexistente o inválida), `PT001`, `PT057` (moneda), `045` (fondos insuficientes).
- Pruebas en UAT: llaves `KP 3001234567`, `KE USUARIO@CORREO.COM`, `KA @COLOMBIA`, `KM 0012345678`, `KI CC12345678` resuelven bien; `KE BLOCKED@TEST.COM`, `KM 0011111111`, `KP 3000005001` y `KI ERRDICE9994` fallan con `PT060`. El resultado del envío se controla con el `totalAmount` de prueba (por ejemplo `4016` da fondos insuficientes).

## Las 10 pautas de Bre-B

| # | Pauta | Estado |
|---|---|---|
| 1 | Cálculos de `subtotalIva`, `subtotalIva0` e `iva` correctos | Cumple (mismo cálculo que ACH) |
| 2 | Mensajes en pantalla según las respuestas de Kushki | Pendiente: faltan los códigos propios (`PT060`, `045`, etc.) |
| 3 | Guardar todas las respuestas de Kushki | Cumple para ACH; falta guardar `keyResolution` |
| 4 | Mostrar `keyResolution` y pedir confirmación antes del envío | **Pendiente** (no hay paso de confirmación) |
| 5 | Procesador Bre-B configurado en la consola | **Pendiente: lo hace Kushki** |
| 6 | Omitir el correo en el token si no se envía recibo | Cumple |
| 7 | Webhooks responden 200 | Cumple (mismo endpoint que ACH; falta activarlo en Kushki) |
| 8 | Botón deshabilitado tras el primer clic | Cumple en la lógica existente; hay que replicarlo en el formulario Bre-B |
| 9 | Logo de Kushki visible | Pendiente (falta el archivo) |
| 10 | Todos los campos obligatorios de la API Reference | Pendiente de implementar |

## Qué falta construir

1. Formulario de retiro con opción "Bre-B": tipo de llave y llave, validando el formato de cada tipo.
2. Paso de confirmación con el nombre del titular que devuelve Kushki (`keyResolution`) antes de enviar.
3. Base de datos: guardar el tipo de llave y la llave cifrada, y la resolución mostrada al usuario.
4. Envío y conciliación Bre-B (reutilizan la lógica de ACH; la llegada es en segundos).
5. Mensajes en español para `PT060`, `045` y los demás códigos.
6. Pruebas con las llaves de UAT, una vez Kushki habilite el procesador.
