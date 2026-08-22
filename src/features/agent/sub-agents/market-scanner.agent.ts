export async function runMarketScanner(): Promise<string> {
  console.log('\x1b[35m[Markus Skinner]\x1b[0m Analizando el mercado de Bybit en busca de oportunidades...');
  try {
    const useTestnet = process.env.PAPER_MODE_ONLY === 'true' || process.env.BYBIT_ENV === 'testnet';
    const baseUrl = useTestnet ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';

    const response = await fetch(`${baseUrl}/v5/market/tickers?category=linear`);
    if (!response.ok) {
      throw new Error(`Bybit Market Data API error: ${response.status}`);
    }

    const json = await response.json();
    if (json.retCode !== 0) {
      throw new Error(`Bybit API Error: ${json.retMsg}`);
    }

    const list = json.result?.list || [];
    
    // Filtramos solo pares con USDT
    const usdtPairs = list.filter((t: any) => t.symbol.endsWith('USDT'));

    // Ordenamos por volumen de 24h (turnover24h)
    const sortedByVolume = [...usdtPairs].sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h));
    const topVolume = sortedByVolume.slice(0, 5);

    // Ordenamos por volatilidad/cambio de precio absoluto (price24hPcnt)
    const sortedByVolatility = [...usdtPairs].sort((a, b) => Math.abs(parseFloat(b.price24hPcnt)) - Math.abs(parseFloat(a.price24hPcnt)));
    const topVolatility = sortedByVolatility.slice(0, 5);

    let report = `### Market Scanner Report (Top Oportunidades en Bybit)\n`;
    report += `**Top 5 por Volumen (Liquidez):**\n`;
    topVolume.forEach((t: any) => {
      report += `- ${t.symbol}: Precio ${t.lastPrice} | Volumen 24h: $${parseFloat(t.turnover24h).toLocaleString()} | Cambio: ${(parseFloat(t.price24hPcnt) * 100).toFixed(2)}%\n`;
    });

    report += `\n**Top 5 por Volatilidad (Movimiento Fuerte):**\n`;
    topVolatility.forEach((t: any) => {
      report += `- ${t.symbol}: Precio ${t.lastPrice} | Cambio: ${(parseFloat(t.price24hPcnt) * 100).toFixed(2)}%\n`;
    });

    report += `\n*Sugerencia para el CEO: Si el activo actual está estancado o tiene poco movimiento, podés usar la herramienta switch_monitored_asset para cambiar tu atención a alguno de estos.*`;

    return report;
  } catch (error: any) {
    console.error('\x1b[35m[Markus Skinner]\x1b[0m Error:', error.message);
    return `Error en el Market Scanner: ${error.message}`;
  }
}
