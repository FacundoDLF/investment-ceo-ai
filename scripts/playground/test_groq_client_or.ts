import { groqClient } from './src/shared/lib/groq';

async function testGroqClientWithOpenRouter() {
  try {
    const response = await groqClient.chat.completions.create({
      model: 'meta-llama/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'test' }]
    });
    console.log('Success:', response.id);
  } catch(e: any) {
    console.error('Error status:', e.status);
    console.error('Error name:', e.name);
    console.error('Error message:', e.message);
  }
}

testGroqClientWithOpenRouter();
