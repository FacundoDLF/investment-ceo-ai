import { z } from 'zod';

export const tavilyResearchSchema = z.object({
  query: z.string().describe('Search query for deep research and extensive content reading.'),
  searchDepth: z.enum(['basic', 'advanced']).optional().default('advanced').describe('Depth of the research. Default is advanced for deep analysis.'),
});

export type TavilyResearchArgs = z.infer<typeof tavilyResearchSchema>;

export const tavilyResearchTool = {
  type: 'function' as const,
  function: {
    name: 'tavily_research',
    description: 'Use for deep analysis and extensive content reading on specific topics. Queries Tavily API.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'The search query for deep research (e.g. "Federal Reserve interest rate impact on S&P 500").',
        },
        searchDepth: {
          type: 'string',
          enum: ['basic', 'advanced'],
          description: 'Depth of research. Default "advanced".',
        }
      },
      required: ['query'],
    },
  },
};

export async function executeTavilyResearch(args: string): Promise<any> {
  let parsedArgs: TavilyResearchArgs;
  try {
    parsedArgs = tavilyResearchSchema.parse(JSON.parse(args));
  } catch (error) {
    return { error: 'Invalid arguments for tavily_research', details: error };
  }

  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    return { error: 'TAVILY_API_KEY is not defined.' };
  }

  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        api_key: apiKey,
        query: parsedArgs.query,
        search_depth: parsedArgs.searchDepth,
        include_answer: true,
        max_results: 5
      })
    });

    if (!response.ok) {
      throw new Error(`Tavily API error: ${response.statusText}`);
    }

    const data = await response.json();

    return {
      query: parsedArgs.query,
      answer: data.answer,
      results: (data.results || []).map((r: any) => ({
        title: r.title,
        url: r.url,
        content: r.content
      }))
    };
  } catch (error: any) {
    return { error: 'Failed to execute Tavily research.', details: error instanceof Error ? error.message : String(error) };
  }
}
