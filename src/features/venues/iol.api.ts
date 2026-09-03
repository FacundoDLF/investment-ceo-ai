import { getIolAccessToken } from './iol.auth';

import { LOG_PREFIX, ANSI_COLORS } from '@/shared/constants/colors';

const BASE_URL = 'https://api.invertironline.com';

async function fetchIol(endpoint: string) {
  const token = await getIolAccessToken();
  if (!token) {
    console.error(`\n${ANSI_COLORS.RED}${ANSI_COLORS.BOLD}🛑 ERROR FATAL: PÉRDIDA DE AUTENTICACIÓN CON IOL 🛑${ANSI_COLORS.RESET}`);
    console.error(`${ANSI_COLORS.RED}El sistema no pudo obtener un token de acceso para InvertirOnline.${ANSI_COLORS.RESET}`);
    console.error(`${ANSI_COLORS.RED}El proceso se detendrá para proteger el estado de la cartera.${ANSI_COLORS.RESET}\n`);
    process.exit(1);
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json'
    }
  });

  if (!response.ok) {
    const errorText = await response.text();
    let parsedError = errorText;
    try {
      const jsonError = JSON.parse(errorText);
      parsedError = jsonError.message || jsonError.error || errorText;
    } catch(e) {}

    if (response.status === 401) {
      console.error(`\n${ANSI_COLORS.RED}${ANSI_COLORS.BOLD}🛑 ERROR FATAL: TOKEN IOL EXPIRADO O INVÁLIDO (HTTP 401) 🛑${ANSI_COLORS.RESET}`);
      console.error(`${ANSI_COLORS.RED}Detalle de la API: ${parsedError}${ANSI_COLORS.RESET}`);
      console.error(`${ANSI_COLORS.RED}Abortando ejecución por seguridad.${ANSI_COLORS.RESET}\n`);
      process.exit(1);
    }
    throw new Error(`IOL API HTTP ${response.status}: ${parsedError}`);
  }

  return await response.json();
}

export async function getEstadoCuenta() {
  // https://api.invertironline.com/api/v2/estadocuenta
  return fetchIol('/api/v2/estadocuenta');
}

export async function getPortafolioArgentina() {
  // https://api.invertironline.com/api/v2/portafolio/argentina
  return fetchIol('/api/v2/portafolio/argentina');
}

export async function getOpciones(mercado: string, simbolo: string) {
  // https://api.invertironline.com/api/v2/{mercado}/Titulos/{simbolo}/Opciones
  return fetchIol(`/api/v2/${mercado}/Titulos/${simbolo}/Opciones`);
}

export async function getPanelOpciones() {
  // Trae TODAS las opciones del panel
  return fetchIol('/api/v2/Cotizaciones/Opciones/argentina/Todos');
}

export async function getCotizacionMep() {
  return fetchIol('/api/v2/Cotizaciones/MEP');
}
