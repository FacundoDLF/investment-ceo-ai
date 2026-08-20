import { validateOrder } from '../features/risk/risk.engine';
import { OrderProposal } from '../shared/interfaces/order.interface';

const currentBalance = 10000; // $10,000

console.log('--- TEST DEL MOTOR DE RIESGO ---');
console.log(`Balance actual: $${currentBalance}\n`);

// Escenario A: Trade de oro (Alta probabilidad y buen ratio)
// Win rate: 60% (0.6), Win/Loss Ratio: 2
// Edge = (0.6 * 2) - 0.4 = 1.2 - 0.4 = 0.8 (Edge muy positivo)
// Kelly f* = 0.8 / 2 = 0.4 -> Kelly Fraccionado (0.25) = 0.1 (10%)
// Max riesgo = 10,000 * 0.1 = 1,000
const scenarioA: OrderProposal = {
  symbol: 'XAU/USD',
  side: 'buy',
  expectedWinProbability: 0.6,
  expectedWinLossRatio: 2,
  proposedRiskAmount: 500 // 500 <= 1000, debe ser aprobado
};

console.log('Escenario A: Trade de oro (Alta prob y buen ratio)');
console.log(validateOrder(scenarioA, currentBalance));
console.log('--------------------------------------------------\n');

// Escenario B: Trade suicida (Edge negativo)
// Win rate: 30% (0.3), Win/Loss Ratio: 1.5
// Edge = (0.3 * 1.5) - 0.7 = 0.45 - 0.7 = -0.25 (Edge negativo)
const scenarioB: OrderProposal = {
  symbol: 'SHIB/USDT',
  side: 'buy',
  expectedWinProbability: 0.3,
  expectedWinLossRatio: 1.5,
  proposedRiskAmount: 100 
};

console.log('Escenario B: Trade suicida (Edge negativo)');
console.log(validateOrder(scenarioB, currentBalance));
console.log('--------------------------------------------------\n');

// Escenario C: Trade codicioso (Edge positivo, pero proposedRiskAmount mayor al límite seguro)
// Win rate: 55% (0.55), Win/Loss Ratio: 1.2
// Edge = (0.55 * 1.2) - 0.45 = 0.66 - 0.45 = 0.21 (Edge positivo)
// Kelly f* = 0.21 / 1.2 = 0.175 -> Kelly Fraccionado (0.25) = 0.04375 (4.375%)
// Max riesgo = 10,000 * 0.04375 = 437.5
const scenarioC: OrderProposal = {
  symbol: 'BTC/USD',
  side: 'buy',
  expectedWinProbability: 0.55,
  expectedWinLossRatio: 1.2,
  proposedRiskAmount: 1000 // 1000 > 437.5, debe ser rechazado
};

console.log('Escenario C: Trade codicioso (Riesgo mayor al límite)');
console.log(validateOrder(scenarioC, currentBalance));
console.log('--------------------------------------------------\n');
