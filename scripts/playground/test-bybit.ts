import 'dotenv/config';
import { BybitAdapter } from './src/features/venues/bybit.adapter';

async function testPositions() {
  const adapter = new BybitAdapter();
  console.log('Fetching Open Positions from Adapter...');
  const positions = await adapter.getOpenPositions();
  console.log('Adapter Positions:', positions);
}

testPositions().catch(console.error);
