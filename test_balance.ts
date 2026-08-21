import { BybitAdapter } from './src/features/venues/bybit.adapter';
import dotenv from 'dotenv';
dotenv.config();

async function getBalance() {
  const adapter = new BybitAdapter();
  const balance = await adapter.getAvailableBalance();
  console.log('Balance Details:', JSON.stringify(balance, null, 2));
}

getBalance();
