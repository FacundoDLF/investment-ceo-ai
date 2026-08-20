export interface BalanceBreakdown {
  cash: number;
  dayTradingPower: number;
  overnightPower: number;
  marginMultiplier: number;
}

export interface OrderParams {
  symbol: string;
  side: 'buy' | 'sell';
  qty: number;
  type: 'market' | 'limit';
  limitPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
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
   * Obtiene el precio actual (Bid/Ask) del mercado para un instrumento.
   * @param symbol Símbolo del activo (ej. 'AAPL', 'BTCUSDT').
   * @returns Bid y Ask actuales.
   */
  getMarketPrice(symbol: string): Promise<{ bid: number; ask: number }>;

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
}
