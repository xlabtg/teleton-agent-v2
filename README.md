# Teleton Agent V2

Autonomous AI Agent for Telegram & TON Blockchain — created by [XLabTG](https://github.com/xlabtg).

## Overview

Teleton V2 is a production-grade autonomous AI agent platform that operates as a real Telegram user account (via MTProto, not a bot), with deep TON blockchain integration, a multi-agent coordination network, and a rich set of V2 features built on clean architecture principles.

This is a **unified repository** that includes everything from V1 ([teleton-agent](https://github.com/xlabtg/teleton-agent)) and V2 in a single self-contained codebase. You can deploy this repository independently — no need to install V1 separately. The WebUI dashboard, setup wizard, CLI, agent management, and all V1 tools are included.

### Key Capabilities

| Capability                  | Description                                                          |
| --------------------------- | -------------------------------------------------------------------- |
| **Full Telegram Access**    | Real user account via MTProto, not a bot                             |
| **Agentic Loop**            | Think, act, observe, repeat until the task is done                   |
| **Hybrid RAG Memory**       | Semantic vector + associative graph + importance-scored retention    |
| **Predictive Intelligence** | Prediction engine, caching, anomaly detection                        |
| **Multi-Agent System**      | Agent registry, task delegation, execution pipeline, self-correction |
| **Time Intelligence**       | Temporal context awareness, smart scheduling                         |
| **Security Layer**          | Zero-trust validation, JWT/RBAC, audit logging                       |
| **Integrations**            | Unified API gateway, event-driven architecture                       |
| **Generative UI**           | Dynamic dashboards, auto-widgets                                     |
| **Self-Improvement**        | Feedback learning, dynamic prompt optimization                       |
| **Agent Network**           | Cross-agent communication protocol (V2-21)                           |
| **TON Blockchain**          | Wallet, jettons, DEX swaps, DNS, NFTs                                |

---

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
├── agents/            # Multi-agent system
│   ├── agent-registry.ts
│   ├── discovery-service.ts
│   ├── execution-pipeline.ts
│   ├── health-checker.ts
│   ├── self-correction.ts
│   └── task-delegation.ts
│
├── memory/            # Hybrid memory system
│   ├── vector-store.ts        # Semantic vector search
│   ├── graph-store.ts         # Associative graph memory
│   ├── semantic-search.ts
│   ├── hybrid-retrieval.ts
│   ├── importance-scorer.ts
│   ├── retention-policy.ts
│   └── embedding-provider.ts
│
├── intelligence/      # Predictive intelligence
│   ├── prediction-engine.ts
│   ├── predictive-cache.ts
│   ├── anomaly-detector.ts
│   ├── behavior-tracker.ts
│   ├── pattern-miner.ts
│   ├── smart-scheduler.ts
│   ├── temporal-context.ts
│   └── urgency-detector.ts
│
├── integrations/      # API gateway + event-driven architecture
│   ├── api-gateway.ts
│   ├── circuit-breaker.ts
│   ├── credential-manager.ts
│   ├── dead-letter-queue.ts
│   ├── event-bus.ts
│   ├── event-schema.ts
│   └── event-store.ts
│
├── security/          # Zero-trust security layer
│   ├── audit-logger.ts
│   ├── audit-query.ts
│   ├── audit-store.ts
│   ├── authorization-middleware.ts
│   ├── injection-detector.ts
│   ├── input-validator.ts
│   └── rate-limiter.ts
│
├── ui/                # Generative UI
│   ├── dashboard-generator.ts
│   ├── dashboard-streamer.ts
│   ├── widget-registry.ts
│   ├── widget-composer.ts
│   ├── widget-templates.ts
│   ├── auto-widgets.ts
│   ├── data-analyzer.ts
│   └── layout-engine.ts
│
├── learning/          # Self-improvement system
│   ├── feedback-collector.ts
│   ├── feedback-analyzer.ts
│   ├── strategy-adjuster.ts
│   ├── prompt-optimizer.ts
│   ├── prompt-composer.ts
│   ├── prompt-registry.ts
│   ├── prompt-tracker.ts
│   └── ab-testing.ts
│
├── network/           # Cross-agent communication protocol
│   ├── protocol.ts
│   ├── message-schema.ts
│   ├── handshake.ts
│   ├── context-serializer.ts
│   └── message-router.ts
│
└── sdk/               # Plugin SDK for third-party extensions

apps/
├── agent/             # Main application entry point (TeletonApp)
└── cli/               # CLI interface (Commander)

v1-src/                # V1 source code (fully working V1 agent)
├── agent/             # V1 agent runtime, tools (Telegram, TON, DeDust, StonFi, etc.)
├── api/               # V1 management API
├── bot/               # V1 Telegram bot (deals, inline router)
├── cli/               # V1 CLI (setup, start, doctor)
├── config/            # V1 configuration loader & schema
├── memory/            # V1 memory system (RAG, embeddings, journal)
├── providers/         # V1 LLM providers (Groq, Claude Code)
├── services/          # V1 services (analytics, audit, metrics, TTS)
├── telegram/          # V1 Telegram client & handlers
├── ton/               # V1 TON wallet & transfers
├── webui/             # V1 WebUI backend (routes, middleware, setup)
└── workspace/         # V1 workspace manager

web/                   # V1 WebUI frontend (React + Vite)
├── src/components/    # Dashboard, setup wizard, agent control
├── src/pages/         # Dashboard, Config, Hooks, Tools, etc.
└── src/hooks/         # React hooks (agent status, config, theme)

configs/               # YAML configuration + Zod schemas
config.example.yaml    # V1 example configuration (comprehensive)
docs/v2-architecture/  # V2 feature specifications
v1-docs/               # V1 documentation (deployment, plugins, Telegram setup, etc.)
```

---

## Prerequisites

- **Node.js 20+** — [Download](https://nodejs.org/)
- **npm** (bundled with Node.js) — yarn/pnpm not supported
- **Telegram API credentials** — from [my.telegram.org/apps](https://my.telegram.org/apps)
- **LLM API key** — Anthropic (recommended), OpenAI, or another provider
- **Telegram account** — a dedicated account is strongly recommended

> **Security warning**: The agent operates as a real Telegram user account with full account access. Use a dedicated account, not your personal one.

---

## Quick Start

### One-line install

```bash
curl -fsSL https://raw.githubusercontent.com/xlabtg/teleton-agent-v2/main/install.sh | bash
```

### 1. Clone and install

```bash
git clone https://github.com/xlabtg/teleton-agent-v2.git
cd teleton-agent-v2
npm install
```

### 2. Configure

Copy the default config and fill in your credentials:

```bash
mkdir -p ~/.teleton-v2
cp configs/default.yaml ~/.teleton-v2/config.yaml
```

Edit `~/.teleton-v2/config.yaml`:

```yaml
telegram:
  api_id: 12345678 # from my.telegram.org/apps
  api_hash: "your_api_hash" # from my.telegram.org/apps

llm:
  provider: anthropic
  model: claude-sonnet-4-20250514
  api_key: "sk-ant-..." # or use TELETON_LLM_API_KEY env var

database:
  path: "./data/teleton.db"
```

Alternatively, use environment variables (see [Environment Variables](#environment-variables) below).

### 3. Start

```bash
# Development mode (with hot reload)
npm run dev

# Production mode
npm run build
node dist/apps/agent/index.js

# Using the CLI
npx teleton start
npx teleton start --config ~/.teleton-v2/config.yaml
```

### 4. Verify

The agent starts an HTTP API on port 3000 (configurable). Check the health endpoint:

```bash
curl http://localhost:3000/health
```

---

## Launch Options

### Standard (Node.js)

```bash
# With default config lookup (~/.teleton-v2/config.yaml → configs/default.yaml)
npm run dev

# With explicit config path
npx teleton start --config /path/to/config.yaml

# Production after build
npm run build
node dist/apps/agent/index.js
```

### CLI

The CLI (`apps/cli`) provides the following commands:

```bash
# Start the agent
teleton start
teleton start --config <path>    # -c / --config: path to YAML config file

# Run diagnostics (checks Node.js version, env vars)
teleton doctor

# Show current configuration
teleton config
teleton config --config <path>

# Show help
teleton --help

# Show version
teleton --version
```

Install globally to use without `npx`:

```bash
npm run build
npm install -g .
teleton start
```

### Docker

```bash
# Build the image
docker build -t teleton-agent-v2 .

# Run with persistent data volume
docker run \
  -v ./data:/data \
  -p 3000:3000 \
  -e TELETON_LLM_API_KEY=sk-ant-... \
  -e TELETON_TELEGRAM_API_ID=12345678 \
  -e TELETON_TELEGRAM_API_HASH=your_api_hash \
  teleton-agent-v2
```

Using a config file with Docker:

```bash
docker run \
  -v ~/.teleton-v2:/config:ro \
  -v ./data:/data \
  -p 3000:3000 \
  teleton-agent-v2 \
  node dist/apps/agent/index.js --config /config/config.yaml
```

Docker Compose example:

```yaml
services:
  teleton:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - ~/.teleton-v2:/config:ro
      - teleton-data:/data
    environment:
      - TELETON_LLM_API_KEY=${TELETON_LLM_API_KEY}
      - TELETON_TELEGRAM_API_ID=${TELETON_TELEGRAM_API_ID}
      - TELETON_TELEGRAM_API_HASH=${TELETON_TELEGRAM_API_HASH}
    restart: unless-stopped

volumes:
  teleton-data:
```

### Via the Web Interface

The web interface is included in this repository (ported from V1). No separate installation required.

**Run the setup wizard with WebUI:**

```bash
npm run build
npm run start:v1 -- --webui
# or: node dist/cli/index.js setup --ui
```

The WebUI wizard at `http://localhost:7777` walks you through:

- LLM provider and model selection
- Telegram authentication (QR code or phone number)
- Access policies (who can message the agent)
- Admin user configuration
- TON wallet setup
- Workspace files

Once setup completes, the agent starts automatically.

**Start with dashboard on subsequent runs:**

```bash
npm run start:v1 -- --webui
# or: node dist/cli/index.js start --webui
```

**WebUI configuration** (`~/.teleton/config.yaml`):

```yaml
webui:
  enabled: true
  port: 7777
  host: "127.0.0.1" # localhost only (recommended for security)
  # auth_token: "..."  # auto-generated if omitted
```

Access the dashboard at `http://localhost:7777`.

---

## Configuration Reference

The config file is searched in this order:

1. Path passed via `--config` flag or `start(configPath)` call
2. `~/.teleton-v2/config.yaml`
3. `configs/default.yaml` (bundled default)

Full configuration with all options:

```yaml
telegram:
  api_id: 0 # Required. From my.telegram.org/apps
  api_hash: "" # Required. From my.telegram.org/apps
  # session_string: ""   # Set via TELETON_TELEGRAM_SESSION env var

ton:
  network: "testnet" # "testnet" | "mainnet"
  # mnemonic: ""         # Set via TELETON_TON_MNEMONIC env var

llm:
  provider: "anthropic" # LLM provider name
  model: "claude-sonnet-4-20250514" # Model identifier
  temperature: 0.7 # Sampling temperature (0.0–1.0)
  max_tokens: 4096 # Max tokens per LLM response
  # api_key: ""          # Set via TELETON_LLM_API_KEY env var

database:
  path: "./data/teleton.db" # SQLite database file path

api:
  port: 3000 # HTTP server port
  host: "0.0.0.0" # Bind address
  cors:
    - "http://localhost:5173" # Allowed CORS origins

security:
  rate_limit_window: 900000 # Rate limit window in ms (default: 15 minutes)
  rate_limit_max: 100 # Max requests per window per IP
  # jwt_secret: ""           # Set via TELETON_JWT_SECRET env var

agent:
  max_iterations: 20 # Max agentic loop iterations per task
  timeout_ms: 120000 # Task timeout in ms (default: 2 minutes)
  personality: |
    You are Teleton, a personal AI agent for Telegram and TON blockchain.
    You help users manage their Telegram accounts and TON wallets.
    You are helpful, precise, and security-conscious.
```

### Environment Variables

All sensitive values can be set via environment variables with the `TELETON_` prefix:

| Variable                    | Description                                   |
| --------------------------- | --------------------------------------------- |
| `TELETON_TELEGRAM_API_ID`   | Telegram API ID (from my.telegram.org/apps)   |
| `TELETON_TELEGRAM_API_HASH` | Telegram API hash (from my.telegram.org/apps) |
| `TELETON_TELEGRAM_SESSION`  | Telegram session string (base64 encoded)      |
| `TELETON_TON_MNEMONIC`      | TON wallet mnemonic phrase                    |
| `TELETON_LLM_API_KEY`       | LLM provider API key                          |
| `TELETON_JWT_SECRET`        | JWT signing secret for API authentication     |

Environment variables take precedence over values in the config file.

---

## Telegram Setup

1. Go to [my.telegram.org/apps](https://my.telegram.org/apps) and log in with your dedicated Telegram account.
2. Create a new application — fill in any name and short name.
3. Copy the **App api_id** and **App api_hash** to your config or environment variables.
4. On first run, the agent will prompt for your phone number and the verification code sent by Telegram to authenticate and create a session.

---

## TON Blockchain Setup

1. Create a TON wallet (e.g., [Tonkeeper](https://tonkeeper.com/)) and export the 24-word mnemonic.
2. Set the mnemonic via `TELETON_TON_MNEMONIC` or in `ton.mnemonic` in the config.
3. Set `ton.network` to `"mainnet"` for production or `"testnet"` for testing.
4. Fund the wallet with TON before using blockchain features.

---

## V2 Feature Specifications

All 21 V2 features are fully implemented. Detailed specifications live in `docs/v2-architecture/`.

### Memory System (V2-01 to V2-03)

| Feature                            | Package           | Description                                                                  |
| ---------------------------------- | ----------------- | ---------------------------------------------------------------------------- |
| **V2-01** Semantic Vector Memory   | `packages/memory` | Embedding-based vector store for semantic similarity search using sqlite-vec |
| **V2-02** Associative Graph Memory | `packages/memory` | Graph-structured memory for entity relationships and associative recall      |
| **V2-03** Importance & Retention   | `packages/memory` | Importance scoring with automatic retention policy and memory compaction     |

### Predictive Intelligence (V2-04 to V2-06)

| Feature                     | Package                 | Description                                                     |
| --------------------------- | ----------------------- | --------------------------------------------------------------- |
| **V2-04** Prediction Engine | `packages/intelligence` | Behavioral pattern mining and next-action prediction            |
| **V2-05** Predictive Cache  | `packages/intelligence` | Pre-fetches likely-needed data based on predicted user behavior |
| **V2-06** Anomaly Detection | `packages/intelligence` | Detects behavioral anomalies and unusual usage patterns         |

### Multi-Agent System (V2-07 to V2-10)

| Feature                      | Package           | Description                                                |
| ---------------------------- | ----------------- | ---------------------------------------------------------- |
| **V2-07** Agent Registry     | `packages/agents` | Central registry for agent discovery and capability lookup |
| **V2-08** Task Delegation    | `packages/agents` | Routes tasks to the most capable available agent           |
| **V2-09** Execution Pipeline | `packages/agents` | Ordered multi-step task execution with rollback support    |
| **V2-10** Self-Correction    | `packages/agents` | Detects and recovers from agent errors mid-execution       |

### Time Intelligence (V2-11 to V2-12)

| Feature                    | Package                 | Description                                                      |
| -------------------------- | ----------------------- | ---------------------------------------------------------------- |
| **V2-11** Temporal Context | `packages/intelligence` | Maintains awareness of time, deadlines, and event history        |
| **V2-12** Smart Scheduling | `packages/intelligence` | Natural-language schedule parsing and autonomous task scheduling |

### Security Layer (V2-13 to V2-14)

| Feature                         | Package             | Description                                            |
| ------------------------------- | ------------------- | ------------------------------------------------------ |
| **V2-13** Zero-Trust Validation | `packages/security` | Validates every input and request regardless of source |
| **V2-14** Audit Logging         | `packages/security` | Tamper-evident audit trail for all agent actions       |

### Integrations (V2-15 to V2-16)

| Feature                             | Package                 | Description                                            |
| ----------------------------------- | ----------------------- | ------------------------------------------------------ |
| **V2-15** Unified API Gateway       | `packages/integrations` | Circuit-breaker-backed gateway for all external APIs   |
| **V2-16** Event-Driven Architecture | `packages/integrations` | Typed event bus with dead-letter queue and event store |

### Generative UI (V2-17 to V2-18)

| Feature                     | Package       | Description                                                |
| --------------------------- | ------------- | ---------------------------------------------------------- |
| **V2-17** Dynamic Dashboard | `packages/ui` | Generates and streams adaptive dashboards based on context |
| **V2-18** Auto-Widgets      | `packages/ui` | Automatically composes UI widgets from data shapes         |

### Self-Improvement (V2-19 to V2-20)

| Feature                     | Package             | Description                                                  |
| --------------------------- | ------------------- | ------------------------------------------------------------ |
| **V2-19** Feedback Learning | `packages/learning` | Collects and analyzes user feedback to adjust agent strategy |
| **V2-20** Dynamic Prompts   | `packages/learning` | A/B tests and optimizes system prompts based on outcomes     |

### Agent Network (V2-21)

| Feature                        | Package            | Description                                                                                                                 |
| ------------------------------ | ------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| **V2-21** Cross-Agent Protocol | `packages/network` | Standardized protocol for inter-agent message exchange, context sharing, and capability negotiation across trust boundaries |

---

## API Reference

The agent exposes an HTTP API on port 3000 (default).

### Authentication

All API endpoints (except `/health`) require a JWT Bearer token:

```
Authorization: Bearer <jwt_token>
```

Roles: `admin`, `user`, `plugin`, `readonly`.

### Endpoints

| Method | Path          | Description                               |
| ------ | ------------- | ----------------------------------------- |
| `GET`  | `/health`     | Health check — returns `{ status: "ok" }` |
| `GET`  | `/agents`     | List all registered agents                |
| `GET`  | `/agents/:id` | Get agent details                         |
| `GET`  | `/tasks`      | List tasks                                |
| `POST` | `/tasks`      | Create and dispatch a new task            |
| `GET`  | `/tasks/:id`  | Get task status and result                |

---

## Security

- **JWT authentication** with role-based access control (admin, user, plugin, readonly)
- **Rate limiting** per IP and per user (configurable window and request cap)
- **Security headers** — CSP, HSTS, X-Frame-Options, X-Content-Type-Options
- **Input validation** — all inputs validated with Zod schemas before processing
- **Injection detection** — prompt injection and command injection detection
- **Zero-trust** — every request validated regardless of internal or external origin
- **Audit logging** — tamper-evident log of all agent actions
- **Non-root Docker** — container runs as the `node` user, not root

See `configs/security-checklist.yaml` for the full pre-launch security checklist.

---

## Development

### Prerequisites

```bash
node --version   # must be >= 20
npm --version    # bundled with Node.js
```

### Setup

```bash
npm install
```

### Available Scripts

```bash
# V2 (new architecture)
npm run dev           # Start V2 in development mode (tsx watch)
npm run build         # Build everything (V1 + V2 + WebUI)
npm run build:v2      # Build only V2 packages
npm run build:v1      # Build only V1 backend
npm run build:web     # Build only WebUI frontend
npm test              # Run all tests with Vitest
npm run typecheck     # TypeScript strict type check (tsc --noEmit)
npm run lint          # ESLint across all packages
npm run format:check  # Prettier format check
npm run doctor        # Run typecheck + lint + test + circular dependency check

# V1 (fully working agent with WebUI)
npm run dev:v1        # Start V1 agent in development mode
npm run dev:web       # Start WebUI in development mode (Vite)
npm run start:v1      # Start V1 agent in production mode
npm run setup         # Run V1 setup wizard
npm run doctor:v1     # Run V1 health checks
```

### Running Tests

```bash
# Run all tests
npm test

# Run a specific test file
npx vitest run __tests__/agents/agent-registry.test.ts

# Run tests in watch mode
npx vitest
```

Tests are located in `__tests__/` and mirror the `packages/` structure. They use Vitest with in-process mocks — no external services required.

### Project Conventions

- **TypeScript strict mode** (`strict: true`, `noUnusedLocals`, `noUnusedParameters`)
- **ESM modules** — `.js` extensions in all imports (NodeNext resolution)
- **File naming** — `kebab-case` for files, `PascalCase` for classes, `camelCase` for functions
- **Formatting** — Prettier (double quotes, semicolons, 100-char width, 2-space indent)
- **Linting** — TypeScript-ESLint, `no-console: warn`
- **Dependency direction** — `core` has zero external deps; `infrastructure` and `api` depend on `core`

---

## Docker

### Build

```bash
docker build -t teleton-agent-v2 .
```

The Dockerfile uses a two-stage build:

1. **build** — Node 20 slim, installs all deps, builds V1 + V2 + WebUI
2. **runtime** — Minimal production image, non-root user, `/data` volume

The container exposes port 7777 (WebUI) and port 3000 (V2 API).

### Run

```bash
docker run \
  -v ./data:/data \
  -p 3000:3000 \
  -e TELETON_TELEGRAM_API_ID=12345678 \
  -e TELETON_TELEGRAM_API_HASH=your_api_hash \
  -e TELETON_LLM_API_KEY=sk-ant-... \
  -e TELETON_JWT_SECRET=your-secret \
  teleton-agent-v2
```

The container healthcheck polls `GET /health` every 30 seconds.

---

## CI/CD

The GitHub Actions pipeline (`.github/workflows/ci.yml`) runs on every push and pull request:

1. **Security audit** — `npm audit`
2. **Type check** — `tsc --noEmit`
3. **Lint** — ESLint
4. **Format** — Prettier check
5. **Tests** — Vitest
6. **Build** — tsup
7. **Docker build** — on pushes to `main` only

---

## License

See [LICENSE](LICENSE) for details.
