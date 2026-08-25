# Investment CEO AI

An autonomous AI-driven investment system (CEO Agent & Quant Agent) capable of analyzing markets and executing trades via Bybit and Alpaca.

## Features
- **Dual-Agent Architecture:** A CEO Agent for high-level strategy and a Quant Agent for precision execution.
- **LLM Fallback System:** Uses Groq natively for high-speed inference (HFT) and falls back to OpenRouter to ensure high availability.
- **Multi-Broker Execution:** Supports Bybit (Crypto Spot & Hedge Mode) and Alpaca.
- **Smart Analyst Tool:** Deep reasoning using OpenRouter models when market conditions are ambiguous.
- **Double Validation Protocol:** Strict `validate_trade_intent` protocol to avoid "Insufficient Balance" or "Qty invalid" errors at execution time.

## Getting Started

### Prerequisites
- Node.js v20+
- Environment variables configured in `.env` (Groq API, OpenRouter API, Bybit Keys, Alpaca Keys, etc.).

### Installation
```bash
npm install
```

### Running the System
```bash
# Start the general CEO loop
npm run ceo

# Start the CEO loop specifically for Crypto (Bybit)
npm run ceo:crypto

# Chat directly with the CEO
npm run chat
```

## Documentation

- [WORKFLOW.md](./WORKFLOW.md) - Explains the core execution loop and agent interactions.
- [PROJECT_KNOWLEDGE.md](./PROJECT_KNOWLEDGE.md) - Critical architectural decisions and troubleshooting. **MANDATORY read for contributors.**
- [CHANGELOG.md](./CHANGELOG.md) - Version history and release notes.
