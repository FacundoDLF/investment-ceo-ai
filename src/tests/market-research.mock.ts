import YahooFinance from 'yahoo-finance2';

const yahooFinance = new YahooFinance();

export async function executeMarketResearchMock(query: string, maxResults: number = 5) {
  try {
    const searchResults = await yahooFinance.search(query, { newsCount: maxResults });

    const results = searchResults.news.map((item: any) => ({
      title: item.title,
      url: item.link,
      snippet: item.publisher,
      publishedAt: item.providerPublishTime,
    }));

    if (results.length === 0) {
      if (query.toLowerCase().includes('fed') || query.toLowerCase().includes('spy') || query.toLowerCase().includes('interest rate')) {
         return {
           query,
           results: [
             {
               title: 'FED mantiene tasas de interés estables, Powell da señales dovish',
               url: 'https://finance.yahoo.com/news/fed-decision',
               snippet: 'La Reserva Federal ha decidido mantener las tasas de interés, pero Jerome Powell insinuó un posible recorte en el futuro. El mercado espera un impacto positivo en índices como el S&P 500 (SPY) debido a una política monetaria más laxa.',
               publishedAt: new Date().toISOString()
             }
           ]
         };
      }
      return { message: `No se encontraron resultados web para la consulta: "${query}".` };
    }

    return { query, results };
  } catch (error: any) {
    return { error: 'Fallo al ejecutar la búsqueda web mockeada.', details: error.message };
  }
}
