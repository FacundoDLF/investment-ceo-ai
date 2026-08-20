import { OrderProposal } from '../../shared/interfaces/order.interface';

export class RiskEngine {
  /**
   * Calculates the maximum position size (amount to risk) using the Fractional Kelly Criterion.
   * Uses formula: f* = (bp - q) / b
   * 
   * @param balance Current available balance
   * @param probability Expected win probability (p)
   * @param winLossRatio Expected win/loss ratio (b)
   * @param fraction Fractional multiplier for Kelly (default 0.25 for conservative sizing)
   * @returns The maximum amount to risk in the balance currency. Returns 0 if edge is negative.
   */
  static calculatePositionSize(
    balance: number,
    probability: number,
    winLossRatio: number,
    fraction: number = 0.25
  ): number {
    // Basic validation
    if (probability <= 0 || probability >= 1 || winLossRatio <= 0 || balance <= 0) {
      return 0;
    }

    const b = winLossRatio;
    const p = probability;
    const q = 1 - p;

    // Calculamos explícitamente el Edge (Esperanza matemática)
    const edge = (p * b) - q;

    // Si el Edge es negativo o cero, prohibición absoluta de operar
    if (edge <= 0) {
      return 0;
    }

    // Kelly fraction: f* = edge / b
    const kellyFraction = edge / b;

    // Apply fractional multiplier (e.g., 0.25 for quarter Kelly)
    const appliedFraction = kellyFraction * fraction;

    // Ensure we never suggest risking more than 100% of the balance
    const safeFraction = Math.min(appliedFraction, 1);

    return balance * safeFraction;
  }
}

/**
 * Pure function to validate if a proposed order exceeds the permitted risk limit.
 * 
 * @param proposal The order proposal containing risk parameters
 * @param currentBalance The current available balance
 * @returns Object indicating if order is valid and the maximum allowed risk
 */
export function validateOrder(proposal: OrderProposal, currentBalance: number): { 
  isApproved: boolean; 
  maxAllowedAmount: number; 
  reason?: string 
} {
  const maxAllowedAmount = RiskEngine.calculatePositionSize(
    currentBalance,
    proposal.expectedWinProbability,
    proposal.expectedWinLossRatio
  );

  if (maxAllowedAmount <= 0) {
    return {
      isApproved: false,
      maxAllowedAmount,
      reason: 'Rechazado: Esperanza matemática negativa o nula',
    };
  }

  if (proposal.proposedRiskAmount > maxAllowedAmount) {
    return {
      isApproved: false,
      maxAllowedAmount,
      reason: 'Rechazado: El riesgo propuesto supera el límite máximo de seguridad de Kelly Fraccionado',
    };
  }

  return {
    isApproved: true,
    maxAllowedAmount,
  };
}
