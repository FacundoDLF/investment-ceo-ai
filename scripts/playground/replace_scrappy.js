const fs = require('fs');

const path = 'src/features/agent/sub-agents/scrappy.agent.ts';
let content = fs.readFileSync(path, 'utf8');

const target = `    const response = await createChatCompletionWithRetry({
      model: 'meta-llama/llama-3.3-70b-instruct',
      fallbackModels: [
        'qwen/qwen-2.5-72b-instruct',
        'google/gemma-4-31b-it:free',
        'z-ai/glm-5.2:free',
        'openrouter/free'
      ],
      messages: [{ role: 'system', content: systemPrompt }],`;

const replacement = `    const response = await createChatCompletionWithRetry({
      role: 'EXECUTOR',
      messages: [{ role: 'system', content: systemPrompt }],`;

content = content.replace(target, replacement);
fs.writeFileSync(path, content);
console.log('Replaced in scrappy.agent.ts');
