import 'dotenv/config';
import { KMSClient, GenerateDataKeyCommand } from '@aws-sdk/client-kms';
import { CONTEXTO_LLAVE } from '../utils/awsBootstrap';

// Crea la llave de cifrado de datos de TrendPay y la imprime "envuelta" con tu llave maestra de KMS.
// El valor impreso (KMS_WRAPPED_KEY) es seguro de guardar: sin KMS es solo ruido. La llave real NUNCA se imprime.
// Se ejecuta UNA sola vez. Uso:
//   KMS_KEY_ID=alias/trendpay-datos AWS_REGION=us-east-1 npx tsx src/scripts/generarLlaveKms.ts
async function main() {
  const keyId = process.env.KMS_KEY_ID;
  if (!keyId) throw new Error('Falta KMS_KEY_ID (el alias o ARN de tu llave maestra, ej. alias/trendpay-datos)');

  const cliente = new KMSClient({ region: process.env.AWS_REGION || 'us-east-1' });
  const r = await cliente.send(new GenerateDataKeyCommand({ KeyId: keyId, KeySpec: 'AES_256', EncryptionContext: CONTEXTO_LLAVE }));
  if (!r.CiphertextBlob) throw new Error('KMS no devolvió la llave envuelta');

  console.log('\nGuarda este valor como KMS_WRAPPED_KEY (en el secreto de AWS o en Railway):\n');
  console.log(Buffer.from(r.CiphertextBlob).toString('base64'));
  console.log('\nGuárdalo además en un lugar seguro: si lo pierdes y no hay otra copia, los datos cifrados con él no se podrán leer.\n');
}

main().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
