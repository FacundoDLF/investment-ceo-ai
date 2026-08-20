import { AlpacaAdapter } from './alpaca.adapter';
import { BybitAdapter } from './bybit.adapter';
import type { IVenueAdapter } from '../../shared/interfaces/venue.adapter';

export type VenueName = 'alpaca' | 'bybit';

const venueRegistry: Record<VenueName, IVenueAdapter> = {
  alpaca: new AlpacaAdapter(),
  bybit: new BybitAdapter(),
};

export async function getUnifiedBalance(venueName: VenueName): Promise<number> {
  const adapter = venueRegistry[venueName];
  
  if (!adapter) {
    throw new Error(`Venue no soportado: ${venueName}`);
  }
  
  return await adapter.getAvailableBalance();
}
