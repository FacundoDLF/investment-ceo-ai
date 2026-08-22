export const TOOL_NAMES_ES: Record<string, string> = {
  consult_smart_analyst: "Consultando con Analista Senior...",
  execute_trade: "Trading...",
  validate_trade_intent: "Validando...",
  close_position: "Cerrando posición...",
  get_account_state: "Verificando Estado de la Cuenta y Posiciones...",
  get_market_price: "Obteniendo precios...",
  get_venue_balance: "Analizando billetera..",
  switch_monitored_asset: "Estoy aburrido! Cambiando el foco...",
  command_scrappy: "Solicitando a Scrappy..",
  serper_search: "Actualizando noticias y novedades...",
  tavily_research: "Iniciando investigación profunda...",
  calculate_risk_size: "Calculando Tamaño de Riesgo (Kelly Criterion)..."
};

export function getFriendlyToolName(toolName: string): string {
  return TOOL_NAMES_ES[toolName] || toolName;
}
