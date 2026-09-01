export class StateService {
  private static currentCryptoAsset = 'BTCUSDT';

  // Scrappy State
  private static scrappyActive = false; // Por defecto apagado, CEO debe encenderlo
  private static scrappyTargetAsset = 'BTCUSDT';
  private static scrappyBudget = 200; // Presupuesto de $200 USD
  private static scrappyTarget = 20; // Meta de ganancias (10% por defecto)
  private static scrappyAutoResetPnL = true;
  private static scrappyDirective: string | null = null; // Grito directo del CEO

  // Octavio State
  private static octavioActive = false;
  private static octavioTargetAsset = 'BTCUSDT';
  private static octavioBudget = 200;
  private static octavioTarget = 20;
  private static octavioAutoResetPnL = true;
  private static octavioDirective: string | null = null;

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
      target: this.scrappyTarget,
      autoResetPnL: this.scrappyAutoResetPnL
    };
  }

  static setScrappyConfig(active: boolean, asset?: string, budget?: number, target?: number, autoResetPnL: boolean = true): void {
    this.scrappyActive = active;
    this.scrappyAutoResetPnL = autoResetPnL;
    if (asset) this.scrappyTargetAsset = asset.toUpperCase();
    
    if (budget && budget > 0) {
      this.scrappyBudget = budget;
      // Auto-calcular la meta al 10% del presupuesto si no se provee un target explícito
      if (!target) {
        this.scrappyTarget = budget * 0.1;
      }
    }

    if (target && target > 0) this.scrappyTarget = target;
    console.log(`[StateService] Scrappy Config Actualizada: Activo=${this.scrappyActive}, Asset=${this.scrappyTargetAsset}, Budget=${this.scrappyBudget}, Target=${this.scrappyTarget}, AutoResetPnL=${this.scrappyAutoResetPnL}`);
  }

  static getScrappyDirective(): string | null {
    return this.scrappyDirective;
  }

  static setScrappyDirective(directive: string | null): void {
    this.scrappyDirective = directive;
    if (directive) {
      console.log(`[StateService] 📢 NUEVA DIRECTIVA DEL CEO PARA SCRAPPY: "${directive}"`);
    }
  }

  static getOctavioState() {
    return {
      active: this.octavioActive,
      targetAsset: this.octavioTargetAsset,
      budget: this.octavioBudget,
      target: this.octavioTarget,
      autoResetPnL: this.octavioAutoResetPnL
    };
  }

  static setOctavioConfig(active: boolean, asset?: string, budget?: number, target?: number, autoResetPnL: boolean = true): void {
    this.octavioActive = active;
    this.octavioAutoResetPnL = autoResetPnL;
    if (asset) this.octavioTargetAsset = asset.toUpperCase();
    
    if (budget && budget > 0) {
      this.octavioBudget = budget;
      if (!target) {
        this.octavioTarget = budget * 0.1;
      }
    }

    if (target && target > 0) this.octavioTarget = target;
    console.log(`[StateService] Octavio Config Actualizada: Activo=${this.octavioActive}, Asset=${this.octavioTargetAsset}, Budget=${this.octavioBudget}, Target=${this.octavioTarget}, AutoResetPnL=${this.octavioAutoResetPnL}`);
  }

  static getOctavioDirective(): string | null {
    return this.octavioDirective;
  }

  static setOctavioDirective(directive: string | null): void {
    this.octavioDirective = directive;
    if (directive) {
      console.log(`[StateService] 📢 NUEVA DIRECTIVA DEL CEO PARA OCTAVIO: "${directive}"`);
    }
  }
}
