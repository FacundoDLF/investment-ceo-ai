export class StateService {
  private static currentCryptoAsset = 'BTCUSDT';

  static getCurrentCryptoAsset(): string {
    return this.currentCryptoAsset;
  }

  static setCurrentCryptoAsset(asset: string): void {
    console.log(`[StateService] Activo monitoreado cambiado de ${this.currentCryptoAsset} a ${asset}`);
    this.currentCryptoAsset = asset.toUpperCase();
  }
}
