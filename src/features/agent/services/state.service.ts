export class StateService {
  private static currentCryptoAsset = 'BTCUSDT';

  // Scrappy State
  private static scrappyActive = true; // Por defecto encendido en crypto
  private static scrappyTargetAsset = 'BTCUSDT';
  private static scrappyBudget = 10000; // Presupuesto de $10000 USD

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
      budget: this.scrappyBudget
    };
  }

  static setScrappyConfig(active: boolean, asset?: string, budget?: number): void {
    this.scrappyActive = active;
    if (asset) this.scrappyTargetAsset = asset.toUpperCase();
    if (budget && budget > 0) this.scrappyBudget = budget;
    console.log(`[StateService] Scrappy Config Actualizada: Activo=${this.scrappyActive}, Asset=${this.scrappyTargetAsset}, Budget=$${this.scrappyBudget}`);
  }
}
