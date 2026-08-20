import { z } from 'zod';

export const serperSearchSchema = z.object({
  query: z.string().describe('Search query for Google News/Finance to get fast headlines and breaking news.'),
});

export type SerperSearchArgs = z.infer<typeof serperSearchSchema>;

export const serperSearchTool = {
  type: 'function' as const,
  function: {
    name: 'serper_search',
    description: 'Use for fast radar, quick headlines, and breaking news. Queries Google News via Serper API.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query (e.g. "AAPL breaking news").',
        }
      },
      required: ['query'],
    },
  },
};

export async function executeSerperSearch(args: string): Promise<any> {
  let parsedArgs: SerperSearchArgs;
  try {
    parsedArgs = serperSearchSchema.parse(JSON.parse(args));
  } catch (error) {
    return { error: 'Invalid arguments for serper_search', details: error };
  }

  const apiKey = process.env.SERPER_API_KEY;
  if (!apiKey) {
    return { error: 'SERPER_API_KEY is not defined.' };
  }

  const endpoint = 'https://google.serper.dev/news';

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'X-API-KEY': apiKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        q: parsedArgs.query,
        gl: 'us',
        hl: 'en'
      })
    });

    if (!response.ok) {
      throw new Error(`Serper API error: ${response.statusText}`);
    }

    const data = await response.json();
    
    return {
      query: parsedArgs.query,
      results: (data.news || []).slice(0, 5).map((n: any) => ({
        title: n.title,
        url: n.link,
        snippet: n.snippet,
        source: n.source,
        date: n.date
      }))
    };
  } catch (error: any) {
    return { error: 'Failed to execute Serper search.', details: error instanceof Error ? error.message : String(error) };
  }
}
