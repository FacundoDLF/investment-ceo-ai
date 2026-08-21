import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Groq({
  apiKey: process.env.OPENROUTER_API_KEY,
  baseURL: 'https://openrouter.ai/api/v1',
  fetch: async (url, init) => {
    console.log('Intercepted URL:', url);
    // return a fake response to stop it from actually failing
    return new Response(JSON.stringify({}), { status: 200 });
  }
});

async function test() {
  await client.chat.completions.create({
    model: 'test',
    messages: []
  });
}
test();
