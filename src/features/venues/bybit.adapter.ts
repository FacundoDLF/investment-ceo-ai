import { IVenueAdapter, BalanceBreakdown, OrderParams, Position } from '../../shared/interfaces/venue.adapter';
import * as crypto from 'crypto';

export class BybitAdapter implements IVenueAdapter {
  async getCapabilities(): Promise<string[]> {
    return ['TRADE_CRYPTO', 'CASH_OUT'];
  }

  async getAvailableBalance(): Promise<BalanceBreakdown> {
    const useTestnet = process.env.PAPER_MODE_ONLY === 'true' || process.env.BYBIT_ENV === 'testnet';
    const apiKey = useTestnet ? process.env.BYBIT_DEMO_API_KEY : process.env.BYBIT_API_KEY;
    const secretKey = useTestnet ? process.env.BYBIT_DEMO_API_SECRET : process.env.BYBIT_API_SECRET;
    const privateKeyPath = useTestnet ? undefined : process.env.BYBIT_API_PRIVATE_KEY_PATH;

    const baseUrl = useTestnet ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';

    if (!apiKey || (!secretKey && !privateKeyPath)) {
      console.warn('Bybit API credentials missing. Returning empty balance.');
      return { cash: 0, dayTradingPower: 0, overnightPower: 0, marginMultiplier: 1 };
    }

    const timestamp = Date.now().toString();
    const recvWindow = '5000';
    const queryString = 'accountType=UNIFIED';

    const signString = timestamp + apiKey + recvWindow + queryString;

    let signature = '';
    if (secretKey) {
      signature = crypto.createHmac('sha256', secretKey).update(signString).digest('hex');
    } else if (privateKeyPath) {
      const fs = require('fs');
      try {
        const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        const sign = crypto.createSign('SHA256');
        sign.update(signString);
        signature = sign.sign(privateKey, 'base64');
      } catch (err: any) {
        console.error('❌ Error leyendo la clave privada RSA de Bybit:', err.message);
        return { cash: 0, dayTradingPower: 0, overnightPower: 0, marginMultiplier: 1 };
      }
    }

    try {
      const response = await fetch(`${baseUrl}/v5/account/wallet-balance?${queryString}`, {
        method: 'GET',
        headers: {
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
          'X-BAPI-SIGN': signature,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Bybit Balance HTTP Error Response:', { status: response.status, body: errorText });
        return { cash: 0, dayTradingPower: 0, overnightPower: 0, marginMultiplier: 1 };
      }

      const json = await response.json();
      if (json.retCode !== 0) {
        console.error('❌ Bybit API Error:', json.retMsg);
        return { cash: 0, dayTradingPower: 0, overnightPower: 0, marginMultiplier: 1 };
      }

      const list = json.result?.list || [];
      if (list.length > 0) {
        const accountInfo = list[0];

        const totalEquity = parseFloat(accountInfo.totalEquity || '0');
        const totalAvailable = parseFloat(accountInfo.totalAvailableBalance || accountInfo.totalMarginBalance || accountInfo.totalWalletBalance || '0');

        // Calcular el poder de SPOT (generalmente USDT disponible + USDC disponible)
        let spotPower = 0;
        if (accountInfo.coin && Array.isArray(accountInfo.coin)) {
          for (const c of accountInfo.coin) {
            if (c.coin === 'USDT' || c.coin === 'USDC') {
              spotPower += parseFloat(c.walletBalance || '0');
            }
          }
        }

        return {
          cash: totalEquity,
          spotPower: spotPower,
          dayTradingPower: totalAvailable,
          overnightPower: totalAvailable,
          marginMultiplier: 1
        };
      }
      return { cash: 0, spotPower: 0, dayTradingPower: 0, overnightPower: 0, marginMultiplier: 1 };
    } catch (error: any) {
      console.error('❌ Bybit Fetch Error:', error.message);
      return { cash: 0, spotPower: 0, dayTradingPower: 0, overnightPower: 0, marginMultiplier: 1 };
    }
  }

  async executeOrder(params: OrderParams): Promise<any> {
    const useTestnet = process.env.PAPER_MODE_ONLY === 'true' || process.env.BYBIT_ENV === 'testnet';
    const apiKey = useTestnet ? process.env.BYBIT_DEMO_API_KEY : process.env.BYBIT_API_KEY;
    const secretKey = useTestnet ? process.env.BYBIT_DEMO_API_SECRET : process.env.BYBIT_API_SECRET;
    const privateKeyPath = useTestnet ? undefined : process.env.BYBIT_API_PRIVATE_KEY_PATH;

    const baseUrl = useTestnet ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';

    if (!apiKey || (!secretKey && !privateKeyPath)) {
      throw new Error('Bybit API credentials missing');
    }

    const payload: any = {
      category: params.category || 'linear',
      symbol: params.symbol,
      side: params.side === 'buy' ? 'Buy' : 'Sell',
      orderType: params.type === 'market' ? 'Market' : 'Limit',
      qty: params.qty.toString(),
      reduceOnly: params.reduceOnly || false,
      timeInForce: 'GTC',
    };

    if (params.type === 'limit' && params.limitPrice) {
      payload.price = params.limitPrice.toString();
    }
    
    // Bybit V5 spot no acepta takeProfit/stopLoss en el payload base
    if (payload.category !== 'spot') {
      if (params.takeProfit) {
        payload.takeProfit = params.takeProfit.toString();
      }
      if (params.stopLoss) {
        payload.stopLoss = params.stopLoss.toString();
      }
    } else {
      // En Spot Market Buy, Bybit espera qty en USDT (quoteCoin) por defecto.
      // Forzamos baseCoin para que trate el qty como BTC/ETH.
      payload.marketUnit = 'baseCoin';
    }

    if (payload.category === 'linear') {
      payload.positionIdx = 0; // Asumir One-Way mode por defecto
    }

    const sendOrderRequest = async (currentPayload: any) => {
      const timestamp = Date.now().toString();
      const recvWindow = '5000';
      const payloadStr = JSON.stringify(currentPayload);
      const signString = timestamp + apiKey + recvWindow + payloadStr;
      
      let signature = '';
      if (secretKey) {
        signature = crypto.createHmac('sha256', secretKey).update(signString).digest('hex');
      } else if (privateKeyPath) {
        const fs = require('fs');
        const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
        const sign = crypto.createSign('SHA256');
        sign.update(signString);
        signature = sign.sign(privateKey, 'base64');
      }

      const response = await fetch(`${baseUrl}/v5/order/create`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-BAPI-API-KEY': apiKey,
          'X-BAPI-TIMESTAMP': timestamp,
          'X-BAPI-RECV-WINDOW': recvWindow,
          'X-BAPI-SIGN': signature,
        },
        body: payloadStr,
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Bybit Order API HTTP error: ${response.status} - ${errorText}`);
      }

      return await response.json();
    };

    let json = await sendOrderRequest(payload);

    // Si falla por Hedge Mode, reintentamos asumiendo la posición correcta
    if (json.retCode !== 0 && json.retMsg.includes('position idx not match position mode') && payload.category === 'linear') {
      console.log('🔄 Detectado Hedge Mode en Bybit. Ajustando positionIdx...');
      if (params.reduceOnly) {
        // Al cerrar (reduceOnly), si vendemos estamos cerrando un Long (idx 1). Si compramos cerramos Short (idx 2).
        payload.positionIdx = params.side === 'sell' ? 1 : 2;
      } else {
        // Al abrir, si compramos abrimos Long (idx 1). Si vendemos abrimos Short (idx 2).
        payload.positionIdx = params.side === 'buy' ? 1 : 2;
      }
      json = await sendOrderRequest(payload);
    }

    if (json.retCode !== 0) {
      throw new Error(`Bybit API Error: ${json.retMsg}`);
    }

    return json.result;
  }

  async getMarketPrice(symbol: string): Promise<{ bid: number; ask: number }> {
    const useTestnet = process.env.PAPER_MODE_ONLY === 'true' || process.env.BYBIT_ENV === 'testnet';
    const baseUrl = useTestnet ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';

    const response = await fetch(`${baseUrl}/v5/market/tickers?category=linear&symbol=${symbol}`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Bybit Market Data API error: ${response.status} - ${errorText}`);
    }

    const json = await response.json();
    if (json.retCode !== 0) {
      throw new Error(`Bybit API Error: ${json.retMsg}`);
    }

    const list = json.result?.list || [];
    if (list.length === 0) {
      throw new Error(`No quote found for symbol: ${symbol}`);
    }

    const ticker = list[0];
    return {
      bid: parseFloat(ticker.bid1Price || ticker.lastPrice || '0'),
      ask: parseFloat(ticker.ask1Price || ticker.lastPrice || '0'),
    };
  }

  async executeCashOut(amount: number, destination: string): Promise<string> {
    console.log(`[Bybit] Ejecutando cash-out de $${amount} hacia ${destination}`);
    return 'mock_tx_id_bybit';
  }

  async getOpenPositions(): Promise<Position[]> {
    const useTestnet = process.env.PAPER_MODE_ONLY === 'true' || process.env.BYBIT_ENV === 'testnet';
    const apiKey = useTestnet ? process.env.BYBIT_DEMO_API_KEY : process.env.BYBIT_API_KEY;
    const secretKey = useTestnet ? process.env.BYBIT_DEMO_API_SECRET : process.env.BYBIT_API_SECRET;
    const privateKeyPath = useTestnet ? undefined : process.env.BYBIT_API_PRIVATE_KEY_PATH; // Asumimos que para demo usarán el secret generado por el sistema

    // Demo Trading in Bybit uses api-demo.bybit.com
    const baseUrl = useTestnet ? 'https://api-demo.bybit.com' : 'https://api.bybit.com';

    if (!apiKey) {
      console.warn('Bybit API key missing in environment variables. Returning empty positions.');
      return [];
    }

    if (!secretKey && !privateKeyPath) {
      console.warn('Bybit secret key or private key missing. Returning empty positions.');
      return [];
    }

    const timestamp = Date.now().toString();
    const recvWindow = '5000';

    const fetchPositionsForCoin = async (coin: string) => {
      const queryString = `category=linear&settleCoin=${coin}`;
      const signString = timestamp + apiKey + recvWindow + queryString;
      
      let signature = '';
      if (secretKey) {
        signature = crypto.createHmac('sha256', secretKey).update(signString).digest('hex');
      } else if (privateKeyPath) {
        const fs = require('fs');
        try {
          const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
          const sign = crypto.createSign('SHA256');
          sign.update(signString);
          signature = sign.sign(privateKey, 'base64');
        } catch (err: any) {
          console.error(`❌ Error leyendo la clave privada RSA de Bybit para ${coin}:`, err.message);
          return [];
        }
      }

      try {
        const response = await fetch(`${baseUrl}/v5/position/list?${queryString}`, {
          method: 'GET',
          headers: {
            'X-BAPI-API-KEY': apiKey,
            'X-BAPI-TIMESTAMP': timestamp,
            'X-BAPI-RECV-WINDOW': recvWindow,
            'X-BAPI-SIGN': signature,
          },
        });

        if (!response.ok) {
          console.error(`❌ Bybit Positions HTTP Error Response (${coin}):`, response.status);
          return [];
        }

        const json = await response.json();
        if (json.retCode !== 0) {
          console.error(`❌ Bybit API Error (${coin}):`, json.retMsg);
          return [];
        }

        return json.result?.list || [];
      } catch (error: any) {
        console.error(`❌ Bybit Fetch Error (${coin}):`, error.message);
        return [];
      }
    };

    const usdtPositions = await fetchPositionsForCoin('USDT');
    const usdcPositions = await fetchPositionsForCoin('USDC');
    const allPositions = [...usdtPositions, ...usdcPositions];

    return allPositions.map((pos: any) => ({
      symbol: pos.symbol,
      qty: parseFloat(pos.size || '0'),
      marketValue: parseFloat(pos.positionValue || '0'),
      unrealizedPl: parseFloat(pos.unrealisedPnl || '0'),
      unrealizedPlPc: parseFloat(pos.positionValue) > 0 ? (parseFloat(pos.unrealisedPnl) / parseFloat(pos.positionValue)) : 0,
      currentPrice: parseFloat(pos.markPrice || '0'),
      avgEntryPrice: parseFloat(pos.avgPrice || '0'),
    }));
  }
}
