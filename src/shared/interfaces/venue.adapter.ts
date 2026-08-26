export interface CoinHolding {
  symbol: string;
  balance: number;
  usdValue?: number;
}

export interface BalanceBreakdown {
  cash: number;
  spotPower?: number;
  dayTradingPower: number;
  overnightPower: number;
  marginMultiplier: number;
  coins?: CoinHolding[];
}

export interface OrderParams {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit';
  category?: 'spot' | 'linear';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  reduceOnly?: boolean;
  postOnly?: boolean;
}

export interface Position {
  symbol: string;
  qty: number;
  side?: 'buy' | 'sell';
  marketValue: number;
  unrealizedPl: number;
  unrealizedPlPc: number;
  currentPrice: number;
  avgEntryPrice: number;
}

/**
 * Interfaz base para los adaptadores de brokers (Venues).
 * NOTA CRÍTICA DE SEGURIDAD: Esta interfaz garantiza un cortafuegos unidireccional (Cash-out only).
 * No existen métodos para ingresar fondos o depositar. El fondeo es 100% manual por el usuario.
 */
export interface IVenueAdapter {
  /**
   * Obtiene las capacidades del broker.
   * @returns Una lista de capacidades (ej. ['CASH_OUT', 'TRADE_STOCKS', 'TRADE_CRYPTO']).
   */
  getCapabilities(): Promise<string[]>;

  /**
   * Obtiene el balance disponible para operar o retirar.
   * @returns El balance disponible con desglose de margen.
   */
  getAvailableBalance(): Promise<BalanceBreakdown>;

  /**
   * Obtiene el precio actual (Bid/Ask) y métricas (Funding Rate) del mercado para un instrumento.
   * @param symbol Símbolo del activo (ej. 'AAPL', 'BTCUSDT').
   */
  getMarketPrice(symbol: string): Promise<{ bid: number; ask: number; fundingRate?: number }>;

  /**
   * Obtiene la información del instrumento (tamaño de lote, decimales permitidos, etc).
   * @param symbol Símbolo del activo (ej. 'BTCUSDT').
   */
  getInstrumentInfo(symbol: string): Promise<{ qtyStep: number; minOrderQty: number }>;

  /**
   * Ejecuta una orden de compra o venta en el broker.
   * @param params Parámetros de la orden.
   * @returns El ID de la transacción u orden.
   */
  executeOrder(params: OrderParams): Promise<any>;

  /**
   * Ejecuta un retiro de fondos hacia una cuenta externa segura.
   * @param amount Monto a retirar.
   * @param destination Destino del retiro (ej. 'Wise', 'AstroPay').
   * @returns El ID de la transacción de retiro.
   */
  executeCashOut(amount: number, destination: string): Promise<string>;

  /**
   * Obtiene las posiciones abiertas actualmente en el broker.
   * @returns Un array de posiciones.
   */
  getOpenPositions(): Promise<Position[]>;

  /**
   * Cancela todas las órdenes activas (pendientes) para un símbolo.
   * @param symbol Símbolo del activo.
   * @param category Categoría del activo (opcional).
   */
  cancelAllOrders?(symbol: string, category?: 'linear' | 'spot'): Promise<void>;

  /**
   * Obtiene información sobre una posición cerrada recientemente.
   * @param symbol Símbolo del activo.
   * @returns Información de cierre o null si no se encontró.
   */
  getClosedPositionInfo?(symbol: string): Promise<{ reason: string; closedPnl: number } | null>;
}
