import { IVenueAdapter } from '../../shared/interfaces/venue.adapter';

export class AlpacaAdapter implements IVenueAdapter {
  async getCapabilities(): Promise<string[]> {
    return ['TRADE_STOCKS', 'CASH_OUT'];
  }

  async getAvailableBalance(): Promise<number> {
    const apiKey = process.env.ALPACA_API_KEY_ID;
    const secretKey = process.env.ALPACA_API_SECRET_KEY;
    const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets/v2';

    if (!apiKey || !secretKey) {
      throw new Error('Alpaca API credentials missing in environment variables');
    }

    const response = await fetch(`${baseUrl}/account`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Alpaca HTTP Error Response:', { status: response.status, statusText: response.statusText, body: errorText });
      throw new Error(`Alpaca API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return parseFloat(data.cash);
  }

  async executeTrade(symbol: string, amount: number, side: 'BUY' | 'SELL'): Promise<string> {
    throw new Error('Not implemented yet');
  }

  async executeCashOut(amount: number, destination: string): Promise<string> {
    console.log(`[Alpaca] Ejecutando cash-out de $${amount} hacia ${destination}`);
    return 'mock_tx_id_alpaca';
  }
}
