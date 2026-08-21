import dotenv from 'dotenv';
dotenv.config();

async function testOpenRouter() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  console.log('Testing with API key:', apiKey?.substring(0, 10) + '...');
  
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.3-70b-instruct',
      messages: [{ role: 'user', content: 'hello' }]
    })
  });
  
  console.log('Status:', response.status);
  const data = await response.json();
  console.log('Response:', JSON.stringify(data, null, 2));
}

testOpenRouter();
