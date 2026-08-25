# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2026-08-25

### Added
- **Dual-Client LLM Architecture:** Integration with Groq (native) and OpenRouter (fallback) to ensure high availability and resilience against model deprecations.
- **Smart Analyst Tool:** Added `consult_smart_analyst` to allow the fast Llama model to query a reasoning model on demand.
- **Double Validation Protocol:** `validate_trade_intent` tool implemented to verify Spot/Linear balances before execution.
- **Bybit Adapter Improvements:** Full support for `qtyStep` dynamic precision and Hedge Mode `reduceOnly` position closing.
- **Alpaca Adapter:** Integration for non-crypto market data routing.
- **Execution Daemons:** Scripts `npm run ceo` and `npm run ceo:crypto` for autonomous trading loops.
- **Project Documentation:** Added `PROJECT_KNOWLEDGE.md`, `WORKFLOW.md`, and robust `README.md`.

### Changed
- Project version bumped to `1.0.0` to reflect production-ready stability of the core autonomous loop.
- LLM fallback logic now explicitly handles HTTP 402 errors to prevent total blackout crashes.
