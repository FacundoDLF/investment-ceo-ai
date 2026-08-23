import { AlpacaAdapter } from './alpaca.adapter';
import { BybitAdapter } from './bybit.adapter';
import type { IVenueAdapter, BalanceBreakdown, OrderParams, Position } from '../../shared/interfaces/venue.adapter';

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

export async function getInstrumentInfo(venueName: VenueName, symbol: string): Promise<{ qtyStep: number; minOrderQty: number }> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  return await adapter.getInstrumentInfo(symbol);
}

export async function executeOrder(venueName: VenueName, params: OrderParams): Promise<any> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  return await adapter.executeOrder(params);
}

export async function getUnifiedPositions(venueName: VenueName): Promise<Position[]> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  return await adapter.getOpenPositions();
}

export async function cancelAllOrders(venueName: VenueName, symbol: string, category: 'linear' | 'spot' = 'linear'): Promise<void> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  if (adapter.cancelAllOrders) {
    await adapter.cancelAllOrders(symbol, category);
  }
}

export async function getClosedPositionInfo(venueName: VenueName, symbol: string): Promise<{ reason: string; closedPnl: number } | null> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  if (adapter.getClosedPositionInfo) {
    return await adapter.getClosedPositionInfo(symbol);
  }
  
  return null;
}
