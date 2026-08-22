import Groq from 'groq-sdk';
import dotenv from 'dotenv';
dotenv.config();

const client = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function main() {
  try {
    const models = await client.models.list();
    console.log(models.data.map(m => m.id));
  } catch(e) {
    console.error(e);
  }
}
main();
