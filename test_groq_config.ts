import { groqClient } from './src/shared/lib/groq';
console.log('baseURL:', groqClient.baseURL);
console.log('apiKey length:', groqClient.apiKey?.length);
