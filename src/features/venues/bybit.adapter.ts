import { IVenueAdapter } from '../../shared/interfaces/venue.adapter';

export class BybitAdapter implements IVenueAdapter {
  async getCapabilities(): Promise<string[]> {
    return ['TRADE_CRYPTO', 'CASH_OUT'];
  }

  async getAvailableBalance(): Promise<number> {
    throw new Error('Not implemented yet');
  }

  async executeTrade(symbol: string, amount: number, side: 'BUY' | 'SELL'): Promise<string> {
    throw new Error('Not implemented yet');
  }

  async executeCashOut(amount: number, destination: string): Promise<string> {
    console.log(`[Bybit] Ejecutando cash-out de $${amount} hacia ${destination}`);
    return 'mock_tx_id_bybit';
  }
}
