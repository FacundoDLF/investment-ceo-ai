# Investment CEO AI Workflow

This document describes the primary execution loop of the autonomous Investment CEO AI system.

## 1. Market Data Gathering
The system initiates its loop by querying market data. Depending on the `venue` parameter (e.g., `'bybit'` for crypto, `'alpaca'` for stocks), the Quant Agent gathers real-time price action and market depth, avoiding cross-broker data mismatches.

## 2. CEO Strategy Evaluation
The CEO Agent evaluates the current portfolio and the incoming market data.
- **Consult Smart Analyst:** If the market is highly ambiguous, the CEO invokes the `consult_smart_analyst` tool to query a heavy-weight reasoning model (via OpenRouter) to advise the fast execution model (Llama).
- **Trading Intent:** The CEO formulates a trading intent (e.g., "Buy BTCUSDT" or "Close Long Position").

## 3. Double Validation Protocol
Before executing any trade, the system enforces the **Double Validation Protocol** to guarantee execution safety:
- The CEO MUST call the `validate_trade_intent` tool.
- This tool simulates the order against actual broker balances (Spot or Linear) and dynamic contract rules (like `qtyStep`).
- If validation fails (e.g. Insufficient balance), the CEO receives the feedback internally and adjusts the order size or category without crashing the loop.

## 4. Execution
Once validated, the CEO calls `execute_trade`.
- **Hedge Mode Handling:** If closing a position in Bybit Hedge Mode, the adapter automatically applies `reduceOnly: true` and the correct `positionIdx` (1 for closing Longs, 2 for closing Shorts).
- **Precision Truncation:** Quantities are dynamically truncated to match the exact broker `qtyStep` specifications, preventing "Qty invalid" API rejections.

## 5. Post-Trade & LLM Fallbacks (Resilience)
- If an LLM provider (like Groq) throws a 400/404/429 error during any of these steps, the `Dual-Client` architecture automatically routes the request to OpenRouter using available fallback models.
- If OpenRouter returns a 402 (Payment Required), the execution aborts safely to notify the user of empty funds, preventing infinite fallback loops.
