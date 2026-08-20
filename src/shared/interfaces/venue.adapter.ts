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
   * @returns El balance disponible.
   */
  getAvailableBalance(): Promise<number>;

  /**
   * Ejecuta una orden de compra o venta en el broker.
   * @param symbol Símbolo del activo (ej. 'AAPL', 'BTCUSDT').
   * @param amount Cantidad a operar.
   * @param side 'BUY' para compra, 'SELL' para venta.
   * @returns El ID de la transacción u orden.
   */
  executeTrade(symbol: string, amount: number, side: 'BUY' | 'SELL'): Promise<string>;

  /**
   * Ejecuta un retiro de fondos hacia una cuenta externa segura.
   * @param amount Monto a retirar.
   * @param destination Destino del retiro (ej. 'Wise', 'AstroPay').
   * @returns El ID de la transacción de retiro.
   */
  executeCashOut(amount: number, destination: string): Promise<string>;
}
