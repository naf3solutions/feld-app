// __BUILD_TIME__ wird von Vite zur Build-Zeit als ISO-String ersetzt
// (siehe vite.config.js -> define).
const buildTime = new Date(__BUILD_TIME__);

export const BUILD_LABEL = 'Rev. ' + buildTime.toLocaleString('de-DE', {
  day: '2-digit',
  month: '2-digit',
  year: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
}).replace(',', '');
