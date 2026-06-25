# Teleton Agent V2 — Working Principle

This document describes the detailed working principle of **Teleton Agent V2**: how the system starts, how it processes tasks, and how its subsystems interact to deliver autonomous, context-aware responses.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Startup Sequence](#2-startup-sequence)
3. [Core Agentic Loop (Think → Act → Observe)](#3-core-agentic-loop)
4. [Memory System](#4-memory-system)
5. [Multi-Agent Orchestration](#5-multi-agent-orchestration)
6. [Predictive Intelligence](#6-predictive-intelligence)
7. [Time Intelligence](#7-time-intelligence)
8. [Security Layer](#8-security-layer)
9. [Integrations and Event Bus](#9-integrations-and-event-bus)
10. [Generative UI](#10-generative-ui)
11. [Self-Improvement Loop](#11-self-improvement-loop)
12. [Agent Network Protocol](#12-agent-network-protocol)
13. [Data Flow: End-to-End Request Lifecycle](#13-data-flow-end-to-end-request-lifecycle)
14. [Configuration and Dependency Injection](#14-configuration-and-dependency-injection)
15. [Package Dependency Map](#15-package-dependency-map)

---

## 1. System Overview

Teleton Agent V2 is a production-grade autonomous AI agent that operates as a **real Telegram user account** (via MTProto, not a bot API) and integrates with the **TON blockchain**. It is built as a TypeScript monorepo with 12 packages and 2 applications, following clean (hexagonal) architecture principles.

```
External World
      │
      │  Telegram MTProto
      ▼
┌─────────────────────────────────────────────────────────────────┐
│                        Teleton Agent V2                         │
│                                                                 │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐   │
│  │ Memory   │   │ Intel-   │   │  Multi-  │   │ Security │   │
│  │ System   │   │ ligence  │   │  Agent   │   │  Layer   │   │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘   │
│       │              │              │               │          │
│  ─────┴──────────────┴──────────────┴───────────────┴───────── │
│                       Core Domain                               │
│            (AgentRuntime · AgentOrchestrator)                   │
│  ──────────────────────────────────────────────────────────── │
│       │              │              │               │          │
│  ┌────┴─────┐   ┌────┴─────┐   ┌───┴──────┐   ┌───┴──────┐  │
│  │   API    │   │ Learning │   │  Network │   │   SDK /  │  │
│  │  Server  │   │ / Prompts│   │ Protocol │   │ Plugins  │  │
│  └──────────┘   └──────────┘   └──────────┘   └──────────┘  │
└─────────────────────────────────────────────────────────────────┘
      │
      │  TON Blockchain
      ▼
```

**Key design choices:**

- The **core layer** has zero external dependencies — only TypeScript interfaces.
- All external services (databases, LLMs, Telegram) are accessed through **ports** (interfaces), with concrete **adapters** in the infrastructure layer.
- Components communicate via a **typed event bus** rather than direct calls, enabling loose coupling.

---

## 2. Startup Sequence

When `teleton start` is executed, `TeletonApp` performs six deterministic steps:

```
teleton start [--config path]
       │
       ▼
① Load Configuration
       YAML file → Zod validation → typed AppConfig object
       Search order:
         1. --config flag path
         2. ~/.teleton-v2/config.yaml
         3. configs/default.yaml (bundled)
       │
       ▼
② Create DI Container (Awilix)
       Registers all services by name so they can be
       resolved by any consumer without hard imports.
       │
       ▼
③ Initialize Infrastructure
       - InMemoryEventBus      (typed pub/sub)
       - SQLiteMemoryRepository (memory persistence)
       - SQLiteTaskRepository   (task queue/state)
       │
       ▼
④ Instantiate Agent Runtime + Orchestrator
       AgentRuntime  → manages the agentic loop per task
       AgentOrchestrator → coordinates multiple agents,
                           listens for task events
       │
       ▼
⑤ Start HTTP API Server (Hono on port 3000)
       Registers middleware: JWT auth, RBAC, rate limiting,
       security headers, CORS.
       Registers routes: /health, /agents, /tasks.
       │
       ▼
⑥ Register OS Signal Handlers
       SIGTERM / SIGINT → graceful shutdown:
         flush event bus, close DB connections,
         deregister agents, stop HTTP server.
```

---

## 3. Core Agentic Loop

The fundamental execution model is a **Think → Act → Observe** cycle implemented in `AgentRuntime.runAgenticLoop()`.

```
┌─────────────────────────────────────────────────────────────┐
│                    AgentRuntime Loop                        │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  Build Context                                        │  │
│  │  • retrieve relevant memories (semantic search)      │  │
│  │  • load conversation history                         │  │
│  │  • enumerate available tools                         │  │
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ① THINK                                             │  │
│  │  LLM generates:                                      │  │
│  │    • reasoning (chain-of-thought)                    │  │
│  │    • selected action type                            │  │
│  │    • confidence score                                │  │
│  │    • alternatives considered                         │  │
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ② ACT  (action.type)                                │  │
│  │    "tool_call"  → execute registered tool            │  │
│  │    "message"    → send reply to user                 │  │
│  │    "delegate"   → hand off to another agent          │  │
│  │    "wait"       → pause and re-observe               │  │
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                  │
│                          ▼                                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  ③ OBSERVE                                           │  │
│  │  LLM analyzes the ActionResult:                      │  │
│  │    • summarizes what happened                        │  │
│  │    • decides shouldContinue (bool)                   │  │
│  │    • optionally pre-selects nextAction               │  │
│  └───────────────────────┬──────────────────────────────┘  │
│                          │                                  │
│           ┌──────────────┴──────────────┐                  │
│           │ shouldContinue?             │                  │
│           ▼ yes                         ▼ no               │
│      loop back to ①             return final result        │
│      (max iterations cap)                                   │
└─────────────────────────────────────────────────────────────┘
```

**Safety constraints:**

- `maxIterations` (default: 20) prevents infinite loops.
- `timeoutMs` (default: 120 s) is enforced across the entire task.
- Every action and result is published to the event bus for observability.
- On unrecoverable error → `task.failed` event published, task state set to `"failed"`.

### Tool Registry

Tools are registered at startup (or dynamically via the SDK). Each tool exposes:

```typescript
interface ToolExecutor {
  name: string;
  execute(args: Record<string, unknown>): Promise<unknown>;
}
```

The LLM selects a tool by name; the runtime looks it up in `toolRegistry` (a `Map<string, ToolExecutor>`) and calls `execute()`. Results flow back as `ActionResult` into the next `Observe` step.

---

## 4. Memory System

The memory system (package `@teleton/memory`) provides three complementary stores that together form a **Hybrid RAG (Retrieval-Augmented Generation)** layer.

### 4.1 Semantic Vector Memory (V2-01)

Every memory entry is embedded with a vector model (e.g., OpenAI `text-embedding-3-small`) on write. On retrieval, the query is embedded and compared against all stored vectors using **cosine similarity**.

```
Write path:
  content → EmbeddingProvider → float[] → sqlite-vec table

Read path:
  query → EmbeddingProvider → float[] → cosine similarity search
        → top-K memories above relevance threshold
```

The store interface is backend-agnostic: the default uses SQLite + `sqlite-vec` (in-process, no server), but can be replaced with pgvector or Pinecone by swapping the adapter.

### 4.2 Associative Graph Memory (V2-02)

Entities extracted from conversations are stored as nodes; relationships between them are stored as typed edges:

| Edge type    | Example                               |
| ------------ | ------------------------------------- |
| `mentions`   | "Message #42 mentions 'TON wallet'"   |
| `caused_by`  | "Error X caused_by 'invalid address'" |
| `related_to` | "TON topic related_to jetton topic"   |

Multi-hop graph traversal discovers non-obvious connections that vector search alone would miss. For example, finding all events related to a user, transitively through mentions and causes.

### 4.3 Importance-Based Retention (V2-03)

Every memory has a dynamic importance score computed from multiple signals:

```
importance = f(recency, access_frequency, emotional_weight, explicit_pin)
```

Memories decay over time according to a configurable time-decay function. A background compaction job:

1. Identifies low-scoring memory clusters.
2. Summarises them with the LLM into a single compact memory.
3. Removes the originals.

Users can explicitly **pin** (boost score), **dismiss** (lower score), or **forget** (delete) memories.

Storage is tiered:

- **Hot** — frequently accessed, kept in fast in-memory cache.
- **Warm** — moderately accessed, in SQLite.
- **Cold** — rarely accessed, archived/summarised.

### 4.4 Hybrid Retrieval

When the agent builds context for the LLM, `hybrid-retrieval.ts` merges results from all three stores:

```
incoming query
    ├── vector search  → semantically similar memories
    ├── graph traversal → entity-related memories
    └── importance rank  → high-value persistent facts
         │
         └─► merged, de-duplicated, re-ranked list
                  → injected into LLM context window
```

---

## 5. Multi-Agent Orchestration

The multi-agent system (package `@teleton/agents`) enables a single incoming task to be broken into subtasks and executed by a fleet of specialised agents in parallel.

### 5.1 Agent Registry and Discovery (V2-07)

Each agent announces itself to the **AgentRegistry** with a descriptor:

```typescript
interface AgentDescriptor {
  id: string;
  role: AgentRole; // "orchestrator" | "executor" | "observer" | "specialist"
  capabilities: Capability[]; // e.g. [{name:"ton-transfer", scope:"blockchain"}]
  constraints: Constraint[];
  namespace: string; // multi-tenant isolation
  version: string;
}
```

The **DiscoveryService** answers capability-based and semantic queries:

- _"Which agents can handle TON transfers?"_
- _"Find an agent most similar to this task description."_

A background `HealthChecker` polls registered agents; unresponsive agents are automatically deregistered.

### 5.2 Task Decomposition and Delegation (V2-08)

When a complex task arrives, `TaskDecomposer` breaks it into self-contained subtasks. Two strategies are supported:

| Strategy   | How it works                                     |
| ---------- | ------------------------------------------------ |
| Rule-based | Pattern-match on task type, split by known rules |
| LLM-based  | Ask the LLM to produce a structured subtask list |

The built-in rule-based decomposer is a best-effort placeholder: by default it
slugifies the task name or payload keys into `requiredCapability` values. For
production routing, inject a domain-specific `DecompositionStrategy` or pass the
registry's advertised capability names as `allowedCapabilities`; this validates
derived capabilities during decomposition and fails fast when no registered
capability matches.

`CapabilityMatcher` scores each agent against each subtask. `DelegationRouter` picks the best agent using one of three routing modes:

- **Best-fit** — highest capability score wins.
- **Round-robin** — distributes evenly across capable agents.
- **Load-aware** — picks the agent with the lowest current load.

`ResultAggregator` collects subtask results and merges them, resolving conflicts when agents return contradictory outputs.

### 5.3 Execution Pipeline (V2-09)

Complex tasks with dependencies are managed by the **ExecutionPipeline**:

```
Task Graph (DAG)
  step A ──► step C ──► step E
  step B ──┘           │
                        ▼
                    step F (final)
```

1. Steps are topologically sorted so dependencies run first.
2. Each step runs with configurable **retry + exponential backoff**.
3. A **checkpoint** is written to SQLite after each successful step.
4. On failure mid-pipeline: the pipeline reloads from the last checkpoint and re-executes from there.
5. If recovery is impossible: **rollback** executes compensating actions in reverse order.
6. Progress events are published to the event bus for real-time status reporting.

### 5.4 Self-Correcting Execution Loop (V2-10)

When a step fails, `SelfCorrection` kicks in before giving up:

```
Error occurs
    │
    ▼
ErrorClassifier
  ├── timeout        → retry with longer timeout
  ├── rate_limit     → backoff, then retry
  ├── validation     → fix input, retry
  ├── auth           → HALT (never auto-correct)
  └── data_corrupt   → HALT (never auto-correct)
    │
    ▼
CorrectionStrategy selected from registry
    │
    ▼
Retry loop (max attempts enforced)
    │
    ▼
CorrectionHistory updated
    (used to skip known-bad strategies in future)
    │
    ├── success → continue pipeline
    └── exhausted → circuit breaker opens, task fails
```

Hard rule: **auth** and **data corruption** errors are never auto-corrected — they always surface to the operator.

---

## 6. Predictive Intelligence

The intelligence package (`@teleton/intelligence`) adds proactive capabilities on top of the reactive loop.

### 6.1 Prediction Engine (V2-04)

`PatternMiner` scans interaction history to extract **behavioral patterns** — recurring sequences of user actions. `PredictionEngine` converts these patterns into intent predictions with confidence scores:

```
interaction history → PatternMiner → patterns
                                       │
                                       ▼
                                 PredictionEngine
                                       │
                              intent prediction + confidence
```

Every prediction is tracked; correct predictions improve the pattern's weight; incorrect predictions reduce it.

### 6.2 Predictive Response Cache (V2-05)

Rather than caching by exact query string, `PredictiveCache` uses **semantic cache keys** (embeddings):

```
incoming query → embed → compare against cached query embeddings
                           │
                    similarity > threshold?
                    ├── yes → return cached response (cache hit)
                    └── no  → execute normally, store result (cache miss)
```

`PredictionEngine` (V2-04) pre-warms the cache by executing likely-next queries before the user asks them. Cache entries carry TTLs and are invalidated when related data changes.

### 6.3 Anomaly Detection (V2-06)

`BehaviorTracker` builds a baseline profile of normal usage patterns. `AnomalyDetector` watches live interactions:

- **Statistical methods:** z-score, inter-quartile range (IQR) for numeric signals.
- **Pattern matching:** known attack signatures (e.g., prompt injection patterns).

When an anomaly is detected:

1. An alert is created with severity classification (low / medium / high / critical).
2. Investigation context (recent messages, user profile, matched signature) is packaged.
3. The alert is routed to configured channels (log, webhook, Telegram message to operator).

---

## 7. Time Intelligence

### 7.1 Temporal Context (V2-11)

`TemporalContext` normalises all time references in user messages:

| User says            | Resolved to                           |
| -------------------- | ------------------------------------- |
| "last week"          | 2026-03-09 00:00 – 2026-03-15 23:59   |
| "before the meeting" | datetime of nearest scheduled meeting |
| "urgent"             | urgency flag set; elevated priority   |

Memories and context entries are **time-weighted**: more recent information scores higher when the agent builds its LLM context window.

An event **timeline** is constructed per session, allowing the agent to reason about sequences (e.g., "what happened between the error and the resolution?").

### 7.2 Smart Scheduling (V2-12)

`SmartScheduler` parses natural language schedules:

```
"Remind me every Monday at 9am" → recurring trigger: WEEKLY MON 09:00
"Alert me in 30 minutes"        → one-shot trigger: now + 30min
```

Schedules are persisted in SQLite. A trigger loop fires notifications at the right time via configurable delivery channels (Telegram message, API webhook, event bus). Overlap between scheduled items is detected and flagged.

---

## 8. Security Layer

Security is enforced at **multiple boundaries** rather than a single perimeter.

### 8.1 Zero-Trust Input Validation (V2-13)

Every message entering the system passes through a multi-layer validator:

```
raw input
    │
    ▼ Syntax check (length, encoding, format)
    │
    ▼ Semantic check (intent classification)
    │
    ▼ Injection detector (prompt injection patterns + classifiers)
    │
    ▼ Authorization check (user permissions)
    │
    ▼ Rate limiter (per IP and per user)
    │
    ▼ Provenance tag (source tracked for audit)
    │
    ▼ clean, tagged input → agent
```

If any layer rejects the input, processing stops and the rejection is logged.

### 8.2 JWT + RBAC (API Layer)

All HTTP endpoints except `GET /health` require a **JWT Bearer token**. The `authorization-middleware` reads the token, validates the signature against `security.jwtSecret`, extracts the user role, and checks the role against the required permission for the route.

### 8.3 Comprehensive Audit Logging (V2-14)

`AuditLogger` records every significant action as a structured event:

```typescript
{
  id: uuid,
  timestamp: ISO-8601,
  actor: { id, role },
  action: "task.create" | "agent.delegate" | "memory.delete" | …,
  resource: { type, id },
  outcome: "success" | "failure",
  metadata: { … }
}
```

Logs are stored with **integrity verification** (hash chain) to detect tampering. The `AuditQuery` API supports filtering by time range, actor, and action type. Retention policies archive old records automatically. Logs can be exported in CEF or JSON format for SIEM integration.

---

## 9. Integrations and Event Bus

### 9.1 Unified API Gateway (V2-15)

`APIGateway` is the single point of access for all external services (LLM providers, TON node, external webhooks):

- Centralised **credential management** with rotation.
- Automatic **retry** on transient failures.
- **Circuit breaker** prevents cascading failures: after N consecutive errors the circuit opens, subsequent calls fail fast for a cooldown period, then a probe call tests recovery.
- Request/response **transformation** (normalises provider-specific formats).
- Per-service **usage tracking** and cost monitoring.

### 9.2 Event-Driven Architecture (V2-16)

All significant state changes are published as typed events on the **EventBus**:

```
producer.publish(event) → EventBus → [subscriber1, subscriber2, …]
```

Events are **persisted** (`EventStore`) enabling:

- **Replay** — reconstruct state by re-playing events from a point in time.
- **Debugging** — inspect the exact sequence of events that led to a failure.

Failed event deliveries go to a **Dead Letter Queue (DLQ)**. The DLQ can be drained manually or automatically with a retry schedule.

Defined event types include:
`task.assigned`, `task.completed`, `task.failed`, `agent.registered`, `agent.deregistered`, `memory.stored`, `anomaly.detected`, `audit.logged`, and more.

---

## 10. Generative UI

The UI package (`@teleton/ui`) generates visual representations of agent output without hard-coded templates.

### 10.1 Dynamic Dashboard Generation (V2-17)

`DashboardGenerator` analyses the current context (active task, available data types, user preferences) and composes a layout:

```
context → LayoutEngine → widget selections → Dashboard spec (JSON)
                              │
                              ▼
                     streamed to client (SSE / WebSocket)
                     real-time updates as task progresses
```

User preferences are learned over time (V2-19 feedback loop) and fed back to the layout engine.

### 10.2 Auto-Generated Widgets (V2-18)

`AutoWidgets` infers the best widget type from the data shape:

| Data type       | Widget            |
| --------------- | ----------------- |
| Time series     | Line chart        |
| Categorical     | Bar chart / Table |
| Boolean state   | Status card       |
| Free text       | Markdown card     |
| Key-value pairs | Property list     |

Widgets are composable: a dashboard is a tree of widgets, each independently updateable. Interactive widgets (forms, buttons) publish events back to the agent when the user interacts.

---

## 11. Self-Improvement Loop

### 11.1 Feedback-Based Learning (V2-19)

`FeedbackCollector` gathers signals from multiple sources:

| Signal type    | Example                                 |
| -------------- | --------------------------------------- |
| Explicit       | User thumbs-up / thumbs-down            |
| Implicit retry | User rephrases the same request         |
| Edit distance  | User heavily edits agent's draft output |
| Task outcome   | Task succeeded / failed                 |

`FeedbackAnalyzer` maps signals to agent behaviours. `StrategyAdjuster` modifies routing weights, tool preferences, and delegation decisions based on aggregated feedback. An **A/B testing framework** runs controlled experiments to validate improvements with statistical significance before promoting them.

### 11.2 Dynamic Prompt Optimisation (V2-20)

`PromptRegistry` stores versioned prompt templates. Each template variant is tracked for performance (response quality, task success rate, latency).

`PromptOptimiser` applies gradient-free optimisation: it generates candidate modifications, runs them via the A/B framework (V2-19), and promotes the winner. Poorly performing variants are archived, not deleted, preserving audit history.

---

## 12. Agent Network Protocol

The network package (`@teleton/network`) defines how Teleton agents running in **different processes or machines** communicate (V2-21).

### Message Format

```typescript
{
  header: {
    messageId: uuid,
    protocol: "teleton/v2",
    source: agentId,
    destination: agentId | "broadcast",
    timestamp: ISO-8601,
    ttl: number,
  },
  payload: {
    type: "task" | "result" | "heartbeat" | "context",
    body: unknown,
  },
  routing: {
    hops: agentId[],   // visited nodes (loop prevention)
    priority: number,
  }
}
```

### Handshake

Before exchanging tasks, two agents perform a capability handshake:

1. Agent A sends `HELLO` with its capability list.
2. Agent B replies with its own capability list and a session token.
3. Subsequent messages carry the session token for authentication.

Messages are **encrypted in transit**. Context serialisation (`ContextSerializer`) packs the agent's current memory snapshot and task state into a portable format for hand-off across process boundaries.

**Multi-hop routing:** if Agent A cannot reach Agent B directly, it forwards the message to an intermediary. The `hops` field prevents routing loops.

---

## 13. Data Flow: End-to-End Request Lifecycle

The following trace shows exactly what happens from the moment a user message arrives until a response is delivered.

```
User sends Telegram message
          │
          ▼ (MTProto client)
TelegramBridge.onMessage()
          │
          ▼
① Security Boundary
   InputValidator    → reject malformed input
   InjectionDetector → reject prompt injection attempt
   RateLimiter       → reject if over quota
   AuditLogger       → log "message.received"
          │
          ▼
② TaskRepository.create()
   status: "pending"
   EventBus.publish("task.assigned")
          │
          ▼
③ AgentOrchestrator picks up task
   Checks agent registry for appropriate executor
          │
   Complex task?
   ├── yes → TaskDecomposer → subtasks
   │          DelegationRouter → assign subtasks to agents
   │          ExecutionPipeline → ordered, checkpointed execution
   └── no  → AgentRuntime.executeTask(task, agent)
          │
          ▼
④ AgentRuntime: Think → Act → Observe loop
   BuildContext:
     - HybridRetrieval: vector + graph + importance memories
     - TemporalContext: resolve time references
     - PredictiveCache: check cache hit
          │
   THINK: LLM call with full context
          │
   ACT:   tool execution / delegation / reply
          │
   OBSERVE: LLM evaluates result, decides continue/stop
          │
   (repeat up to maxIterations)
          │
          ▼
⑤ Error occurs?
   SelfCorrection: classify → select strategy → retry
   Max retries hit? → circuit breaker → task.failed
          │
          ▼
⑥ Task complete
   TaskRepository.update(status: "completed")
   TaskRepository.storeResult(result)
   EventBus.publish("task.completed")
          │
          ▼
⑦ Memory Update
   VectorStore.upsert(new memories)
   GraphStore.upsert(new entities + relationships)
   ImportanceScorer.update()
          │
          ▼
⑧ Feedback Collection
   FeedbackCollector records implicit signals
   (latency, retries, user edits)
          │
          ▼
⑨ Audit Trail
   AuditLogger.log("task.completed", outcome, actor, resource)
          │
          ▼
⑩ Response delivered to user via TelegramBridge
   or returned via HTTP API POST /tasks response
```

---

## 14. Configuration and Dependency Injection

### Configuration Schema

Configuration is written in YAML and validated with Zod at startup. Any invalid field causes a descriptive error before the agent starts.

```yaml
telegram:
  api_id: 12345678 # MTProto app ID (required)
  api_hash: "…" # MTProto app hash (required)
  session_string: "…" # Saved session (set via env var TELEGRAM_SESSION)

ton:
  network: "testnet" # testnet | mainnet
  mnemonic: "…" # Wallet seed (set via env var TON_MNEMONIC)

llm:
  provider: "anthropic"
  model: "claude-sonnet-4-20250514"
  temperature: 0.7
  max_tokens: 4096
  api_key: "…" # Set via env var ANTHROPIC_API_KEY

database:
  path: "./data/teleton.db"

api:
  port: 3000
  host: "0.0.0.0"
  cors: ["http://localhost:5173"]

security:
  jwt_secret: "…" # Stable high-entropy value, minimum 32 chars; required in production
  rate_limit_window: 900000 # ms (15 min)
  rate_limit_max: 100

agent:
  max_iterations: 20
  timeout_ms: 120000
  personality: "…" # Optional system-prompt customisation
```

### Dependency Injection

**Awilix** is used for IoC. Every service is registered under a canonical name and resolved lazily. This means:

- Tests can swap any adapter (e.g., use an in-memory LLM stub) without changing domain code.
- The same `AgentRuntime` code runs with SQLite locally and with a cloud database in production.

Core ports (interfaces) defined in `packages/core/src/ports/`:

| Port                | Default Adapter              |
| ------------------- | ---------------------------- |
| `MemoryRepository`  | `SQLiteMemoryRepository`     |
| `TaskRepository`    | `SQLiteTaskRepository`       |
| `SessionRepository` | `SQLiteSessionRepository`    |
| `EventRepository`   | `SQLiteEventRepository`      |
| `LLMProvider`       | Anthropic Claude adapter     |
| `TelegramBridge`    | MTProto client adapter       |
| `TonWallet`         | TON SDK adapter              |
| `SecretsProvider`   | Environment variable adapter |
| `EmbeddingProvider` | OpenAI / local model adapter |

---

## 15. Package Dependency Map

The dependency graph enforces clean architecture — arrows show "depends on":

```
apps/agent ──────────────────────────────────────────────────┐
apps/cli  ──────────────────────────────────────────────────┐│
                                                            ││
packages/api ──────────────────────────────────────────┐   ││
packages/agents ───────────────────────────────────┐   │   ││
packages/memory ────────────────────────────────┐  │   │   ││
packages/intelligence ──────────────────────┐   │  │   │   ││
packages/integrations ──────────────────┐   │   │  │   │   ││
packages/security ───────────────────┐  │   │   │  │   │   ││
packages/ui ─────────────────────┐   │  │   │   │  │   │   ││
packages/learning ────────────┐  │   │  │   │   │  │   │   ││
packages/network ──────────┐  │  │   │  │   │   │  │   │   ││
packages/sdk ───────────┐  │  │  │   │  │   │   │  │   │   ││
                        │  │  │  │   │  │   │   │  │   │   ││
packages/infrastructure │  │  │  │   │  │   │   │  │   │   ││
     └──────────────────┘  │  │  │   │  │   │   │  │   │   ││
                           │  │  │   │  │   │   │  │   │   ││
packages/core ◄────────────┴──┴──┴───┴──┴───┴───┴──┴───┴───┴┘
  (zero external deps — the stable centre)
```

**Rule:** `packages/core` must never import from any other package. All other packages may import from `core` and `infrastructure`, but not from `apps/`.

---

## Summary

Teleton Agent V2 operates as a layered, event-driven system:

1. **Startup** bootstraps configuration, DI, infrastructure, and the HTTP server in six deterministic steps.
2. **Each task** runs through the Think → Act → Observe loop, enriched by hybrid memory (vector + graph + importance), temporal context, and a predictive cache.
3. **Complex tasks** are decomposed, delegated to specialised agents, and orchestrated by a checkpointed pipeline with automatic self-correction.
4. **Security** is enforced at the input boundary (validation, injection detection, rate limiting) and tracked end-to-end via tamper-evident audit logs.
5. **Integrations** use a unified API gateway with circuit breakers; all components communicate through a typed, persistent event bus.
6. **The system improves itself** through feedback-based learning and dynamic prompt optimisation, using A/B testing to validate changes before promoting them.
7. **Multiple Teleton instances** can collaborate via the cross-agent network protocol, sharing tasks and context across process boundaries.
