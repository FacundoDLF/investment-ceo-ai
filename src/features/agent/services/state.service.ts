export class StateService {
  private static currentCryptoAsset = 'BTCUSDT';

  // Scrappy State
  private static scrappyActive = false; // Por defecto apagado, CEO debe encenderlo
  private static scrappyTargetAsset = 'BTCUSDT';
  private static scrappyBudget = 200; // Presupuesto de $200 USD
  private static scrappyTarget = 20; // Meta de ganancias (10% por defecto)

  static getCurrentCryptoAsset(): string {
    return this.currentCryptoAsset;
  }

  static setCurrentCryptoAsset(asset: string): void {
    console.log(`[StateService] Activo monitoreado cambiado de ${this.currentCryptoAsset} a ${asset}`);
    this.currentCryptoAsset = asset.toUpperCase();
  }

  static getScrappyState() {
    return {
      active: this.scrappyActive,
      targetAsset: this.scrappyTargetAsset,
      budget: this.scrappyBudget,
      target: this.scrappyTarget
    };
  }

  static setScrappyConfig(active: boolean, asset?: string, budget?: number, target?: number): void {
    this.scrappyActive = active;
    if (asset) this.scrappyTargetAsset = asset.toUpperCase();
    
    if (budget && budget > 0) {
      this.scrappyBudget = budget;
      // Auto-calcular la meta al 10% del presupuesto si no se provee un target explícito
      if (!target) {
        this.scrappyTarget = budget * 0.1;
      }
    }

    if (target && target > 0) this.scrappyTarget = target;
    console.log(`[StateService] Scrappy Config Actualizada: Activo=${this.scrappyActive}, Asset=${this.scrappyTargetAsset}, Budget=${this.scrappyBudget}, Target=${this.scrappyTarget}`);
  }
}
