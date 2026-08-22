export const AGENT_MODELS = {
  MAIN: 'meta-llama/llama-3.3-70b-instruct',
  FALLBACK_PAID: [
    'qwen/qwen-2.5-72b-instruct'
  ],
  FALLBACK_FREE: [
    'google/gemma-4-31b-it:free',
    'z-ai/glm-5.2:free',
    'openrouter/free'
  ]
};

export const DEFAULT_FALLBACK_MODELS = [
  ...AGENT_MODELS.FALLBACK_PAID,
  ...AGENT_MODELS.FALLBACK_FREE
];
