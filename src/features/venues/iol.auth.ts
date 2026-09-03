import { LOG_PREFIX } from '@/shared/constants/colors';
let refreshInterval: NodeJS.Timeout | null = null;

export async function getIolAccessToken(opts: { forceRefresh?: boolean } = {}): Promise<string | null> {
  // Si no forzamos el refresco y ya hay un token manual o previamente guardado, lo devolvemos
  if (!opts.forceRefresh && process.env.IOL_ACCESS_TOKEN) {
    return process.env.IOL_ACCESS_TOKEN;
  }

  // Si no hay token manual, intentamos generarlo con credenciales
  const username = process.env.IOL_USERNAME;
  const password = process.env.IOL_PASSWORD;

  if (!username || !password) {
    return null;
  }

  try {
    console.log(`${LOG_PREFIX.IOL_AUTH} Negociando Token OAuth 2.0 para el usuario ${username}...`);
    
    const params = new URLSearchParams();
    params.append('username', username);
    params.append('password', password);
    params.append('grant_type', 'password');

    const response = await fetch('https://api.invertironline.com/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded'
      },
      body: params.toString()
    });

    if (!response.ok) {
      const errorText = await response.text();
      let parsedError = errorText;
      try {
        const jsonError = JSON.parse(errorText);
        parsedError = jsonError.error_description || jsonError.message || jsonError.error || errorText;
      } catch (e) {}
      
      console.error(`${LOG_PREFIX.IOL_AUTH} Error al autenticar: HTTP ${response.status} - ${parsedError}`);
      return null;
    }

    const data = await response.json();
    // En IOL v1 (clásico) la llave viene como "access token" con espacio o "access_token"
    const accessToken = data.access_token || data["access token"];
    
    if (accessToken) {
      const expiresInSeconds = data.expires_in || 899; // 15 min por defecto
      console.log(`${LOG_PREFIX.IOL_AUTH} Token obtenido con éxito. Válido por ${expiresInSeconds} segundos.`);
      process.env.IOL_ACCESS_TOKEN = accessToken;

      // Configurar Auto-Refresh (1 minuto antes de expirar)
      if (!refreshInterval) {
        const refreshMs = (expiresInSeconds - 60) * 1000;
        refreshInterval = setInterval(() => {
          console.log(`${LOG_PREFIX.IOL_AUTH} 🔄 Auto-refrescando token antes de su expiración...`);
          getIolAccessToken({ forceRefresh: true }).catch(console.error);
        }, refreshMs);
      }

      return accessToken;
    }
    
    console.error(`${LOG_PREFIX.IOL_AUTH} La respuesta no contenía access_token:`, data);
    return null;
  } catch (error: any) {
    console.error(`${LOG_PREFIX.IOL_AUTH} Fallo en la comunicación con el servidor de autenticación:`, error.message);
    return null;
  }
}
