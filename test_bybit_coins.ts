import { BybitAdapter } from './src/features/venues/bybit.adapter';
import dotenv from 'dotenv';
dotenv.config();

async function testBybitBalance() {
  const useTestnet = process.env.PAPER_MODE_ONLY === 'true' || process.env.BYBIT_ENV === 'testnet';
  const apiKey = useTestnet ? process.env.BYBIT_DEMO_API_KEY : process.env.BYBIT_API_KEY;
  const secretKey = useTestnet ? process.env.BYBIT_DEMO_API_SECRET : process.env.BYBIT_API_SECRET;
  
  const timestamp = Date.now().toString();
  const recvWindow = '5000';
  const queryString = 'accountType=UNIFIED';
  
  const crypto = require('crypto');
  const signString = timestamp + apiKey + recvWindow + queryString;
  const signature = crypto.createHmac('sha256', secretKey).update(signString).digest('hex');
  
  const response = await fetch(`https://api-demo.bybit.com/v5/account/wallet-balance?${queryString}`, {
    headers: {
      'X-BAPI-API-KEY': apiKey!,
      'X-BAPI-TIMESTAMP': timestamp,
      'X-BAPI-RECV-WINDOW': recvWindow,
      'X-BAPI-SIGN': signature,
    }
  });
  
  const json = await response.json();
  console.log(JSON.stringify(json.result.list[0].coin, null, 2));
}

testBybitBalance();
