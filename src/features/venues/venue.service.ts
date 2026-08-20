import { AlpacaAdapter } from './alpaca.adapter';
import { BybitAdapter } from './bybit.adapter';
import type { IVenueAdapter, BalanceBreakdown, OrderParams } from '../../shared/interfaces/venue.adapter';

export type VenueName = 'alpaca' | 'bybit';

const venueRegistry: Record<VenueName, IVenueAdapter> = {
  alpaca: new AlpacaAdapter(),
  bybit: new BybitAdapter(),
};

export async function getUnifiedBalance(venueName: VenueName): Promise<BalanceBreakdown> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  return await adapter.getAvailableBalance();
}

export async function getMarketPrice(venueName: VenueName, symbol: string): Promise<{ bid: number; ask: number }> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  return await adapter.getMarketPrice(symbol);
}

export async function executeOrder(venueName: VenueName, params: OrderParams): Promise<any> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  return await adapter.executeOrder(params);
}
