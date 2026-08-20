import { IVenueAdapter, BalanceBreakdown, OrderParams } from '../../shared/interfaces/venue.adapter';

export class AlpacaAdapter implements IVenueAdapter {
  async getCapabilities(): Promise<string[]> {
    return ['TRADE_STOCKS', 'CASH_OUT'];
  }

  async getAvailableBalance(): Promise<BalanceBreakdown> {
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
    return {
      cash: parseFloat(data.cash || '0'),
      dayTradingPower: parseFloat(data.daytrading_buying_power || '0'),
      overnightPower: parseFloat(data.regt_buying_power || '0'),
      marginMultiplier: parseFloat(data.multiplier || '1')
    };
  }

  async executeOrder(params: OrderParams): Promise<any> {
    const apiKey = process.env.ALPACA_API_KEY_ID;
    const secretKey = process.env.ALPACA_API_SECRET_KEY;
    const baseUrl = process.env.ALPACA_BASE_URL || 'https://paper-api.alpaca.markets/v2';

    if (!apiKey || !secretKey) {
      throw new Error('Alpaca API credentials missing in environment variables');
    }

    const payload: any = {
      symbol: params.symbol,
      qty: params.qty,
      side: params.side,
      type: params.type,
      time_in_force: 'gtc'
    };

    if (params.type === 'limit' && params.limitPrice) {
      payload.limit_price = params.limitPrice;
    }

    if (params.stopLoss || params.takeProfit) {
      payload.order_class = 'bracket';
      
      if (params.takeProfit) {
        payload.take_profit = {
          limit_price: params.takeProfit
        };
      }
      
      if (params.stopLoss) {
        payload.stop_loss = {
          stop_price: params.stopLoss,
        };
      }
    }

    const response = await fetch(`${baseUrl}/orders`, {
      method: 'POST',
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Alpaca Order HTTP Error Response:', { status: response.status, statusText: response.statusText, body: errorText });
      throw new Error(`Alpaca Order API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    return await response.json();
  }

  async getMarketPrice(symbol: string): Promise<{ bid: number; ask: number }> {
    const apiKey = process.env.ALPACA_API_KEY_ID;
    const secretKey = process.env.ALPACA_API_SECRET_KEY;
    const baseUrl = process.env.ALPACA_DATA_URL || 'https://data.alpaca.markets/v2';

    if (!apiKey || !secretKey) {
      throw new Error('Alpaca API credentials missing in environment variables');
    }

    const response = await fetch(`${baseUrl}/stocks/${symbol}/quotes/latest`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Alpaca Market Data API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    const quote = data.quote;
    
    if (!quote) {
      throw new Error(`No quote found for symbol: ${symbol}`);
    }

    return {
      bid: parseFloat(quote.bp),
      ask: parseFloat(quote.ap),
    };
  }

  async executeCashOut(amount: number, destination: string): Promise<string> {
    console.log(`[Alpaca] Ejecutando cash-out de $${amount} hacia ${destination}`);
    return 'mock_tx_id_alpaca';
  }
}
