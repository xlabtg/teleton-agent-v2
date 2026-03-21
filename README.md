# Teleton Agent V2

Autonomous AI Agent for Telegram & TON Blockchain — created by [XLabTG](https://github.com/xlabtg).

## Architecture

Teleton V2 follows a **clean architecture** pattern with strict dependency rules:

```
packages/
├── core/              # Business logic (zero external deps)
│   ├── domain/        # Entities, interfaces, domain events
│   ├── usecases/      # Agent runtime, orchestrator
│   ├── ports/         # Repository & service interfaces
│   └── errors/        # Domain error hierarchy
│
├── infrastructure/    # External adapters
│   ├── database/      # SQLite + sqlite-vec
│   ├── secrets/       # Environment / Vault adapter
│   └── events/        # In-memory event bus
│
├── api/               # HTTP layer (Hono)
│   ├── middleware/     # Auth, RBAC, rate limiting, security headers
│   └── routes/        # Health, agents, tasks
│
└── sdk/               # Plugin SDK for third-party extensions

apps/
├── agent/             # Main application entry point
└── cli/               # CLI interface (Commander)

configs/               # YAML configuration + Zod schemas
docs/v2-architecture/  # V2 feature templates (from PR #88)
```

## Quick Start

```bash
# Install dependencies
npm install

# Run tests
npm test

# Start in development mode
npm run dev

# Start with custom config
npx teleton start --config ./configs/default.yaml
```

## Configuration

Copy `configs/default.yaml` to `~/.teleton-v2/config.yaml` and set your credentials:

```yaml
telegram:
  api_id: YOUR_API_ID
  api_hash: YOUR_API_HASH

llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
```

Sensitive values should be set via environment variables with the `TELETON_` prefix.

## Security

- JWT authentication with RBAC (admin, user, plugin, readonly)
- Rate limiting per IP and per user
- Security headers (CSP, HSTS, X-Frame-Options)
- Input validation with Zod schemas
- See `configs/security-checklist.yaml` for the full pre-launch checklist

## Development

```bash
npm run typecheck    # TypeScript strict check
npm run lint         # ESLint
npm run format:check # Prettier
npm run test         # Vitest
npm run doctor       # All checks
```

## Docker

```bash
docker build -t teleton-agent-v2 .
docker run -v ./data:/data -p 3000:3000 teleton-agent-v2
```

## V2 Architecture Templates

See `docs/v2-architecture/` for detailed feature templates covering:

1. **Memory System** — Semantic vector, graph memory, importance retention
2. **Predictive Intelligence** — Prediction engine, caching, anomaly detection
3. **Multi-Agent System** — Agent registry, task delegation, execution pipeline
4. **Time Intelligence** — Temporal context, smart scheduling
5. **Security Layer** — Zero-trust validation, audit logging
6. **Integrations** — Unified API, event-driven architecture
7. **Generative UI** — Dynamic dashboards, auto-widgets
8. **Self-Improvement** — Feedback learning, dynamic prompts
9. **Agent Network** — Cross-agent communication protocol

## License

See [LICENSE](LICENSE) for details.
