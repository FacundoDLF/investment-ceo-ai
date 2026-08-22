export const TRADING_MODES = {
  NORMAL: 'normal',
  CRYPTO: 'crypto',
} as const;

export const SYSTEM_STATES = {
  DAMAGE_CONTROL: 'DAMAGE_CONTROL',
  PORTFOLIO_AUDIT: 'PORTFOLIO_AUDIT',
  CRYPTO_ALWAYS_OPEN: 'CRYPTO_ALWAYS_OPEN',
  RESEARCH_MODE: 'RESEARCH_MODE',
  MARKET_OPEN: 'MARKET_OPEN',
  PRE_MARKET_SYNC: 'PRE_MARKET_SYNC',
  AFTER_HOURS_REVIEW: 'AFTER_HOURS_REVIEW',
} as const;

export const VENUES = {
  BYBIT: 'bybit',
  ALPACA: 'alpaca',
} as const;

export const ASSETS = {
  SPY: 'SPY',
} as const;
