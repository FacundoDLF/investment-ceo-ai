import { IVenueAdapter, BalanceBreakdown, OrderParams } from '../../shared/interfaces/venue.adapter';

export class BybitAdapter implements IVenueAdapter {
  async getCapabilities(): Promise<string[]> {
    return ['TRADE_CRYPTO', 'CASH_OUT'];
  }

  async getAvailableBalance(): Promise<BalanceBreakdown> {
    throw new Error('Not implemented yet');
  }

  async executeOrder(params: OrderParams): Promise<any> {
    throw new Error('Not implemented yet');
  }

  async getMarketPrice(symbol: string): Promise<{ bid: number; ask: number }> {
    throw new Error('Not implemented yet for Bybit');
  }

  async executeCashOut(amount: number, destination: string): Promise<string> {
    console.log(`[Bybit] Ejecutando cash-out de $${amount} hacia ${destination}`);
    return 'mock_tx_id_bybit';
  }
}
