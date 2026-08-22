import { createChatCompletionWithRetry } from './src/shared/lib/groq';

async function test() {
  try {
    await createChatCompletionWithRetry({
      model: 'llama-3.1-8b-instant',
      messages: [{ role: 'user', content: 'hello' }]
    });
    console.log("Success llama-3.1-8b-instant");
  } catch (e: any) {
    console.log("Error llama-3.1-8b-instant:", e.status, e.message);
  }

  try {
    await createChatCompletionWithRetry({
      model: 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: 'hello' }]
    });
    console.log("Success llama-3.3-70b-versatile");
  } catch (e: any) {
    console.log("Error llama-3.3-70b-versatile:", e.status, e.message);
  }
}

test();
