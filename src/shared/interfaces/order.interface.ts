export interface OrderProposal {
  symbol: string;
  side: 'buy' | 'sell';
  expectedWinProbability: number;
  expectedWinLossRatio: number;
  proposedRiskAmount: number;
  strategy?: 'LONG_TERM' | 'INTRADAY';
}
