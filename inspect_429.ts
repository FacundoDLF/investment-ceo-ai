import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function main() {
  try {
    await client.chat.completions.create({
      model: 'openai/gpt-oss-120b',
      messages: [{ role: 'user', content: 'test' }]
    });
  } catch(e: any) {
    console.log('Error name:', e.name);
    console.log('Error message:', e.message);
    console.log('Error status:', e.status);
    console.log('Error headers:', e.headers);
    console.log('Error response headers:', e.response?.headers);
    if (e.error) console.log('e.error:', e.error);
    
    // Extracting wait time from message?
    const match = e.message.match(/Please try again in (\d+(\.\d+)?)s/);
    if (match) {
      console.log('Extracted seconds from message:', match[1]);
    }
  }
}
main();
