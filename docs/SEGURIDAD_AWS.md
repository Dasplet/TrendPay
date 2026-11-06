# Seguridad con AWS: credenciales, llave de cifrado y documentos

Paquete "fuerte". Todo es **opcional y apagado por defecto**: mientras no existan las variables de abajo, TrendPay funciona exactamente igual que antes.

## Qué protege cada pieza

| Pieza | Qué hace | Si alguien roba… |
|---|---|---|
| **AWS Secrets Manager** | Guarda las credenciales (Kushki, JWT, Resend…). El servidor las pide al arrancar y las deja solo en memoria. | …las variables de Railway, ya no encuentra las credenciales ahí. |
| **AWS KMS** | Guarda la llave maestra. La llave de cifrado de datos solo se puede abrir llamando a KMS. | …la base de datos o un respaldo, los datos cifrados son ilegibles sin KMS. |
| **S3 privado + cifrado KMS** | Los documentos de los clientes viven en un bucket privado, cifrados con tu llave. | …el bucket, no puede leer los archivos. Cada lectura queda en el registro de AWS (CloudTrail). |

Límite honesto: las credenciales de AWS del servidor (`AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY`) siguen en Railway. Quien tenga acceso a Railway podría usarlas. La ganancia es que: (1) una base de datos o un respaldo robado no sirve; (2) cada uso queda auditado en AWS; (3) se corta el acceso en un clic desactivando esa clave de IAM; (4) los secretos ya no están a la vista en Railway. Por eso el **2FA en Railway, GitHub y AWS es obligatorio**.

## Pasos (consola de AWS, región `us-east-1` o la que prefieras; usa la misma en todo)

### 1. Cuenta
1. Crea la cuenta en aws.amazon.com y activa **MFA en el usuario raíz**.
2. En *Billing > Budgets* crea un presupuesto de alerta (ej. USD 25/mes).

### 2. Llave maestra (KMS)
*KMS > Customer managed keys > Create key* → Symmetric, Encrypt and decrypt → alias `trendpay` → déjala solo con tu usuario como administrador. Copia el **ARN**.

### 3. Bucket de documentos (S3)
*S3 > Create bucket* → nombre único (ej. `trendpay-documentos-prod`) → **Block all public access: activado** → Versioning: activado → Default encryption: *SSE-KMS* con la llave `trendpay`.

### 4. Secreto (Secrets Manager)
*Secrets Manager > Store a new secret > Other type > Plaintext*, pega un JSON plano con las credenciales:

```json
{
  "JWT_SECRET": "…",
  "JWT_REFRESH_SECRET": "…",
  "KUSHKI_PRIVATE_MERCHANT_ID": "…",
  "KUSHKI_PUBLIC_MERCHANT_ID": "…",
  "KUSHKI_WEBHOOK_SECRET": "…",
  "RESEND_API_KEY": "…",
  "HMAC_SECRET": "…"
}
```
Nombre del secreto: `trendpay/prod`. **No pongas** `DATABASE_URL` ahí (la migración de la base corre antes del arranque seguro) ni `ENCRYPTION_KEY` todavía.

### 5. Usuario del servidor (IAM)
*IAM > Policies > Create policy > JSON* (reemplaza REGION, CUENTA, BUCKET y el ARN de la llave) y llámala `trendpay-api`:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Sid": "Secretos", "Effect": "Allow", "Action": "secretsmanager:GetSecretValue",
      "Resource": "arn:aws:secretsmanager:REGION:CUENTA:secret:trendpay/prod-*" },
    { "Sid": "Llave", "Effect": "Allow", "Action": ["kms:Decrypt", "kms:GenerateDataKey"],
      "Resource": "ARN_DE_LA_LLAVE_TRENDPAY" },
    { "Sid": "Documentos", "Effect": "Allow", "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject"],
      "Resource": "arn:aws:s3:::BUCKET/*" }
  ]
}
```
*IAM > Users > Create user* `trendpay-api` (sin acceso a consola) → adjunta esa política → *Security credentials > Create access key* → guarda el par de claves.

### 6. Llave de cifrado de datos (una sola vez)
Abre **AWS CloudShell** (ícono de terminal en la barra superior) y ejecuta (cambia `us-east-1` si usas otra región). Imprime solo la llave *envuelta*, nunca la llave real:

```bash
aws kms generate-data-key --region us-east-1 --key-id alias/trendpay --key-spec AES_256 \
  --encryption-context app=trendpay,uso=cifrado-de-datos \
  --query CiphertextBlob --output text
```

Copia el texto que sale y agrégalo al secreto del paso 4 como `"KMS_WRAPPED_KEY": "…"`. **Guárdalo también en un lugar seguro fuera de AWS**: sin ese valor los datos nuevos no se pueden leer.

### 7. Variables en Railway (servicio `trendpay-api`)

```
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=…          (del usuario trendpay-api)
AWS_SECRET_ACCESS_KEY=…
AWS_SECRETS_ID=trendpay/prod
S3_BUCKET=trendpay-documentos-prod
S3_REGION=us-east-1
S3_ACCESS_KEY_ID=…           (las mismas claves del usuario trendpay-api)
S3_SECRET_ACCESS_KEY=…
S3_KMS_KEY_ID=alias/trendpay
```
Deja `S3_ENDPOINT` vacío (es solo para R2/MinIO). Después de desplegar y comprobar que todo funciona, **borra de Railway las credenciales que ya están en el secreto** (JWT, Kushki, Resend…). Mantén `DATABASE_URL` y `ENCRYPTION_KEY`.

### 8. Verificar
Despliega y entra a *Admin > Configuración > Seguridad de credenciales y archivos*. Deben quedar en verde "Credenciales en AWS Secrets Manager", "Llave protegida por AWS KMS" y "Documentos cifrados". Si algo falla al arrancar, el servidor **no se levanta** y Railway conserva la versión anterior (el motivo aparece en los logs, sin mostrar valores).

### 9. Re-cifrar lo ya guardado
Lo nuevo ya se cifra con KMS; lo antiguo se sigue leyendo con `ENCRYPTION_KEY`. Para pasarlo todo a KMS:

```bash
cd packages/api
npx tsx src/scripts/reencriptar.ts            # simulación, no cambia nada
npx tsx src/scripts/reencriptar.ts --aplicar  # cambia los datos
```
Hazlo con un respaldo reciente de la base de datos. El panel de Seguridad muestra cuántos registros quedan pendientes.

Los documentos que ya estén en la base de datos (modo anterior) quedan cifrados con KMS tras ese paso. Los nuevos van directo al bucket.

### 10. Auditoría y cierre
- *CloudTrail > Event history*: cada `Decrypt` de KMS y `GetSecretValue` queda registrado (90 días gratis). Para conservar más tiempo, crea un *Trail* hacia un bucket aparte.
- **No borres `ENCRYPTION_KEY`** aunque el panel muestre 0 pendientes: los respaldos anteriores a la migración solo se pueden abrir con esa llave. Guárdala fuera de Railway.
- Rotación: los secretos de terceros (Kushki, Resend) se rotan a mano en cada proveedor y se actualizan en el secreto. Rotar `JWT_SECRET` cierra todas las sesiones. AWS solo rota por sí mismo los secretos de sus propias bases de datos, no estos.
