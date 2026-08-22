import { createChatCompletionWithRetry } from '../../src/shared/lib/groq';
import dotenv from 'dotenv';
dotenv.config();

async function testGroqRetry() {
  try {
    console.log('Testing Chat Completion...');
    const result = await createChatCompletionWithRetry({
      role: 'CEO',
      messages: [{ role: 'user', content: 'Say hello in 5 words.' }],
    }, 3);
    console.log('Success:', result.choices[0].message.content);
  } catch (error: any) {
    console.error('Final Error:', error.message);
  }
}

testGroqRetry();
