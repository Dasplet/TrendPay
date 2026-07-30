// Carga .env.test (si existe) antes de cualquier import de la app.
// En CI las variables ya vienen inyectadas por el workflow y este archivo no existe — está bien, dotenv no sobreescribe nada.
require('dotenv').config({ path: require('path').resolve(__dirname, '.env.test') });
process.env.NODE_ENV = 'test';
