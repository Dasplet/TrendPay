import 'dotenv/config';
import { cargarSecretosAws } from './utils/awsBootstrap';

// Punto de entrada de producción (npm start). Trae secretos y llave de cifrado desde AWS ANTES de cargar la
// aplicación, porque varios módulos leen las variables de entorno apenas se importan.
async function arrancar() {
  try {
    const { secretos, llaveKms } = await cargarSecretosAws();
    if (secretos > 0 || llaveKms) {
      console.log(JSON.stringify({ nivel: 'info', mensaje: 'Arranque seguro con AWS', secretosCargados: secretos, llaveKms }));
    }
  } catch (err) {
    // Sin mostrar valores: solo el motivo. Railway mantiene la versión anterior si el nuevo despliegue no arranca.
    console.error(JSON.stringify({ nivel: 'error', mensaje: 'No se pudo cargar la configuración segura desde AWS; el servidor no arranca', motivo: (err as Error).message }));
    process.exit(1);
  }
  await import('./index');
}

arrancar();
