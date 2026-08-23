import { IVenueAdapter, BalanceBreakdown, OrderParams, Position } from '../../shared/interfaces/venue.adapter';

export class AlpacaAdapter implements IVenueAdapter {
  async getCapabilities(): Promise<string[]> {
    return ['TRADE_STOCKS', 'CASH_OUT'];
  }

  async getAvailableBalance(): Promise<BalanceBreakdown> {
    const apiKey = process.env.ALPACA_API_KEY_ID;
    const secretKey = process.env.ALPACA_API_SECRET_KEY;
    const isPaper = process.env.PAPER_MODE_ONLY === 'true' || process.env.PAPER_MODE_ONLY === undefined;
    const baseUrl = isPaper ? 'https://paper-api.alpaca.markets/v2' : (process.env.ALPACA_BASE_URL || 'https://api.alpaca.markets/v2');

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
      spotPower: parseFloat(data.cash || '0'),
      dayTradingPower: parseFloat(data.daytrading_buying_power || data.buying_power || '0'),
      overnightPower: parseFloat(data.regt_buying_power || data.buying_power || '0'),
      marginMultiplier: parseFloat(data.multiplier || '1'),
      coins: []
    };
  }

  async getInstrumentInfo(symbol: string): Promise<{ qtyStep: number; minOrderQty: number }> {
    // Alpaca usa acciones fraccionarias para stocks (0.0001) y crypto (0.0001).
    // Devolvemos valores seguros genéricos.
    return {
      qtyStep: 0.0001,
      minOrderQty: 0.0001
    };
  }

  async executeOrder(params: OrderParams): Promise<any> {
    const apiKey = process.env.ALPACA_API_KEY_ID;
    const secretKey = process.env.ALPACA_API_SECRET_KEY;
    const isPaper = process.env.PAPER_MODE_ONLY === 'true' || process.env.PAPER_MODE_ONLY === undefined;
    const baseUrl = isPaper ? 'https://paper-api.alpaca.markets/v2' : (process.env.ALPACA_BASE_URL || 'https://api.alpaca.markets/v2');

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

  async getOpenPositions(): Promise<Position[]> {
    const apiKey = process.env.ALPACA_API_KEY_ID;
    const secretKey = process.env.ALPACA_API_SECRET_KEY;
    const isPaper = process.env.PAPER_MODE_ONLY === 'true' || process.env.PAPER_MODE_ONLY === undefined;
    const baseUrl = isPaper ? 'https://paper-api.alpaca.markets/v2' : (process.env.ALPACA_BASE_URL || 'https://api.alpaca.markets/v2');

    if (!apiKey || !secretKey) {
      throw new Error('Alpaca API credentials missing in environment variables');
    }

    const response = await fetch(`${baseUrl}/positions`, {
      headers: {
        'APCA-API-KEY-ID': apiKey,
        'APCA-API-SECRET-KEY': secretKey,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('❌ Alpaca Positions HTTP Error Response:', { status: response.status, statusText: response.statusText, body: errorText });
      throw new Error(`Alpaca Positions API error: ${response.status} ${response.statusText} - ${errorText}`);
    }

    const data = await response.json();
    return data.map((pos: any) => ({
      symbol: pos.symbol,
      qty: parseFloat(pos.qty),
      marketValue: parseFloat(pos.market_value),
      unrealizedPl: parseFloat(pos.unrealized_pl),
      unrealizedPlPc: parseFloat(pos.unrealized_plpc),
      currentPrice: parseFloat(pos.current_price),
      avgEntryPrice: parseFloat(pos.avg_entry_price),
    }));
  }

  async cancelAllOrders(symbol: string, category: 'linear' | 'spot' = 'linear'): Promise<void> {
    console.warn(`[Alpaca] cancelAllOrders not implemented yet for ${symbol}`);
  }
}
