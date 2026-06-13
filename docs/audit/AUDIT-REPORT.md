# Teleton Agent V2 — Full Codebase Audit Report

> Generated from `docs/audit/findings/*.json` by `generate-report.mjs`.
> Audit tracked in issue [#58](https://github.com/xlabtg/teleton-agent-v2/issues/58).

## Scope & Methodology

This report is the result of a full, subsystem-by-subsystem review of the Teleton Agent V2 monorepo: every workspace package (`core`, `infrastructure`, `api`, `agents`, `memory`, `intelligence`, `integrations`, `security`, `network`, `learning`, `ui`, `sdk`), the `apps/` entrypoints, the V1 source tree (`v1-src/`), the React `web/` frontend, and the CI/CD, Docker and packaging configuration.

Each finding was confirmed by reading the referenced source. Suspected issues that turned out to be safe on inspection are listed under **Rejected / verified-safe** rather than filed, to document the verification.

Each filed issue carries: a **severity** label, a **category** label, one or more **`area:*`** component labels, the **`audit`** label, and a **stage milestone**.

## Summary

- **Total confirmed findings:** 141
- **Rejected / verified-safe:** 3

### By severity → stage

| Severity | Count | Implementation stage |
|----------|-------|-----------------------|
| 🔴 CRITICAL | 4 | Stage 1 — Critical: Security & Data Integrity |
| 🟠 HIGH | 34 | Stage 2 — High: Correctness & Reliability |
| 🟡 MEDIUM | 58 | Stage 3 — Medium: Hardening & Robustness |
| 🟢 LOW | 45 | Stage 4 — Low: Tech Debt & Polish |

### By category

| Category | Count |
|----------|-------|
| `correctness` | 38 |
| `security` | 37 |
| `bug` | 17 |
| `reliability` | 11 |
| `resource-leak` | 9 |
| `supply-chain` | 7 |
| `error-handling` | 6 |
| `data-loss` | 4 |
| `ci-cd` | 4 |
| `concurrency` | 2 |
| `performance` | 2 |
| `architecture` | 2 |
| `type-safety` | 2 |

### By component

| Component | Count |
|-----------|-------|
| `area:agents` | 15 |
| `area:api` | 15 |
| `area:build` | 14 |
| `area:intelligence` | 13 |
| `area:security` | 13 |
| `area:web` | 13 |
| `area:integrations` | 12 |
| `area:memory` | 11 |
| `area:v1` | 10 |
| `area:infra` | 8 |
| `area:network` | 8 |
| `area:core` | 5 |
| `area:learning` | 4 |
| `area:docker` | 3 |
| `area:ui` | 3 |

## 🔴 CRITICAL (4)

| # | Title | Category | Component | Location | Issue |
|---|-------|----------|-----------|----------|-------|
| 1 | ensureVecTable drops the vector table (destroying all embeddings) on any dimension change | `data-loss` | `infra` | `packages/infrastructure/src/database/sqlite.adapter.ts:95-109` | [#86](https://github.com/xlabtg/teleton-agent-v2/issues/86) |
| 2 | Handshake nonce is non-random and never tracked, providing no replay protection | `security` | `network` | `packages/network/src/handshake.ts:194,330` | [#149](https://github.com/xlabtg/teleton-agent-v2/issues/149) |
| 3 | Handshake never verifies senderPublicKey/trustProof — any peer is trusted | `security` | `network` | `packages/network/src/handshake.ts:47-50` | [#150](https://github.com/xlabtg/teleton-agent-v2/issues/150) |
| 4 | TON/jetton transfer tools are gated only by scope "dm-only", so any DM user can drive real transfers | `security` | `v1` | `v1-src/agent/tools/ton/index.ts:35,43; v1-src/agent/tools/registry.ts:107-128` | [#177](https://github.com/xlabtg/teleton-agent-v2/issues/177) |

## 🟠 HIGH (34)

| # | Title | Category | Component | Location | Issue |
|---|-------|----------|-----------|----------|-------|
| 1 | Error classifier misclassifies auth and data-corruption errors as recoverable validation errors | `correctness` | `agents` | `packages/agents/src/error-classifier.ts:31-43` | [#122](https://github.com/xlabtg/teleton-agent-v2/issues/122) |
| 2 | Step timeout uses an uncancellable setTimeout, leaking a timer and throwing after the step resolves | `resource-leak` | `agents` | `packages/agents/src/execution-pipeline.ts:49-51,176-187` | [#123](https://github.com/xlabtg/teleton-agent-v2/issues/123) |
| 3 | Checkpoint save inside the step try block misattributes checkpoint failures as step failures and re-runs side effects | `correctness` | `agents` | `packages/agents/src/execution-pipeline.ts:173-206` | [#124](https://github.com/xlabtg/teleton-agent-v2/issues/124) |
| 4 | Checkpoint serialise shallow-copies context and output by reference, so later mutations corrupt the snapshot | `data-loss` | `agents` | `packages/agents/src/checkpoint-store.ts:28-41` | [#125](https://github.com/xlabtg/teleton-agent-v2/issues/125) |
| 5 | RBAC is fail-open and the `/api/agents/*` pattern misses the bare `/api/agents` route | `security` | `api` | `packages/api/src/middleware/auth.middleware.ts:58-66` | [#60](https://github.com/xlabtg/teleton-agent-v2/issues/60) |
| 6 | Auth rate limiter keys on unverified `X-Forwarded-For`, allowing brute-force bypass | `security` | `api` | `packages/api/src/middleware/security.middleware.ts:116-127` | [#61](https://github.com/xlabtg/teleton-agent-v2/issues/61) |
| 7 | `bin/teleton.js` imports `dist/cli/index.js`, which the default build never produces | `bug` | `build` `api` | `bin/teleton.js:2` | [#62](https://github.com/xlabtg/teleton-agent-v2/issues/62) |
| 8 | telegram-notify.yml interpolates workflow_run context directly into a run: shell step | `ci-cd` | `build` | `.github/workflows/telegram-notify.yml:56-67` | [#187](https://github.com/xlabtg/teleton-agent-v2/issues/187) |
| 9 | telegram-action third-party action pinned to mutable @master ref instead of a SHA | `supply-chain` | `build` | `.github/workflows/telegram-notify.yml:37,71` | [#188](https://github.com/xlabtg/teleton-agent-v2/issues/188) |
| 10 | CI, deploy-vercel, and telegram-notify workflows declare no permissions: (broad default GITHUB_TOKEN) | `ci-cd` | `build` | `.github/workflows/ci.yml:1-13` | [#189](https://github.com/xlabtg/teleton-agent-v2/issues/189) |
| 11 | Core runtime dependency telegram resolves to a GitHub fork of gramjs, not the published package | `supply-chain` | `build` | `package.json:97` | [#190](https://github.com/xlabtg/teleton-agent-v2/issues/190) |
| 12 | Agent loop timeout throws inside a setTimeout callback (uncaught crash) and never aborts in-flight work | `error-handling` | `core` | `packages/core/src/usecases/agent-runtime.ts:130-198` | [#90](https://github.com/xlabtg/teleton-agent-v2/issues/90) |
| 13 | Dockerfile runs dependency lifecycle scripts during npm ci (no --ignore-scripts) | `supply-chain` | `docker` `build` | `Dockerfile:21,48-50` | [#191](https://github.com/xlabtg/teleton-agent-v2/issues/191) |
| 14 | Vector dimension check uses substring includes(), so float[38] matches float[384] | `bug` | `infra` | `packages/infrastructure/src/database/sqlite.adapter.ts:101-102` | [#87](https://github.com/xlabtg/teleton-agent-v2/issues/87) |
| 15 | Memory store/update write three tables without a transaction, drifting the vector index out of sync | `data-loss` | `infra` | `packages/infrastructure/src/database/sqlite.adapter.ts:111-143` | [#88](https://github.com/xlabtg/teleton-agent-v2/issues/88) |
| 16 | Each repository opens its own better-sqlite3 connection to the same database file | `resource-leak` | `infra` | `packages/infrastructure/src/database/sqlite.adapter.ts:35-44` | [#89](https://github.com/xlabtg/teleton-agent-v2/issues/89) |
| 17 | A synchronously-throwing event handler escapes Promise.allSettled isolation and breaks dispatch | `bug` | `integrations` | `packages/integrations/src/event-bus.ts:175-186` | [#137](https://github.com/xlabtg/teleton-agent-v2/issues/137) |
| 18 | Circuit breaker allows unlimited concurrent probes in HALF_OPEN (no single-probe gate) | `concurrency` | `integrations` | `packages/integrations/src/circuit-breaker.ts:119-146` | [#138](https://github.com/xlabtg/teleton-agent-v2/issues/138) |
| 19 | Dead-letter queue drops the oldest still-pending entries on overflow instead of applying backpressure | `data-loss` | `integrations` | `packages/integrations/src/dead-letter-queue.ts:93-109` | [#139](https://github.com/xlabtg/teleton-agent-v2/issues/139) |
| 20 | Recurring schedules missed during downtime fire once per poll cycle instead of collapsing to the next future occurrence | `bug` | `intelligence` | `packages/intelligence/src/schedule-store.ts:294-316` | [#109](https://github.com/xlabtg/teleton-agent-v2/issues/109) |
| 21 | userUtcOffsetMinutes is accepted but never applied; all parsed times are computed in UTC | `correctness` | `intelligence` | `packages/intelligence/src/time-parser.ts:18-23,90-101` | [#110](https://github.com/xlabtg/teleton-agent-v2/issues/110) |
| 22 | PromptTracker.outcomeRecords grows without bound (no eviction cap) | `resource-leak` | `learning` | `packages/learning/src/prompt-tracker.ts:50,94` | [#153](https://github.com/xlabtg/teleton-agent-v2/issues/153) |
| 23 | runMaintenance fetches all memories via an empty FTS MATCH query, which SQLite rejects | `bug` | `memory` `infra` | `packages/memory/src/memory-manager.ts:165` | [#98](https://github.com/xlabtg/teleton-agent-v2/issues/98) |
| 24 | findNodesByLabel uses substring matching, merging unrelated nodes during graph extraction | `correctness` | `memory` | `packages/memory/src/graph-store.ts:89-94` | [#99](https://github.com/xlabtg/teleton-agent-v2/issues/99) |
| 25 | getGraphContext passes the raw natural-language query to findNodesByLabel, so graph context is effectively never populated | `bug` | `memory` | `packages/memory/src/memory-manager.ts:219-231` | [#100](https://github.com/xlabtg/teleton-agent-v2/issues/100) |
| 26 | Message router does not clamp TTL to MAX_TTL and performs no loop detection | `security` | `network` | `packages/network/src/message-router.ts:173-229` | [#151](https://github.com/xlabtg/teleton-agent-v2/issues/151) |
| 27 | Message router routes messages without calling validateHeaders | `security` | `network` | `packages/network/src/message-router.ts:173-229` | [#152](https://github.com/xlabtg/teleton-agent-v2/issues/152) |
| 28 | AuditStore eviction permanently breaks hash-chain integrity verification | `bug` | `security` | `packages/security/src/audit-store.ts:60-62,89-99` | [#75](https://github.com/xlabtg/teleton-agent-v2/issues/75) |
| 29 | Audit metadata redaction is shallow and shares nested objects by reference | `security` | `security` | `packages/security/src/audit-event.ts:97-109` | [#76](https://github.com/xlabtg/teleton-agent-v2/issues/76) |
| 30 | CEF audit export does not escape pipes, equals, or newlines (log injection / event forging) | `security` | `security` | `packages/security/src/audit-query.ts:101-113` | [#77](https://github.com/xlabtg/teleton-agent-v2/issues/77) |
| 31 | RateLimiter never evicts windowStates/banStates → unbounded memory growth (DoS) | `resource-leak` | `security` | `packages/security/src/rate-limiter.ts:57-59,94-98,192-197` | [#78](https://github.com/xlabtg/teleton-agent-v2/issues/78) |
| 32 | Deal strategy compliance is checked on valueTon while verification/transfer use tonAmount (decoupled fields) | `correctness` | `v1` | `v1-src/agent/tools/deals/propose.ts:75-87; v1-src/deals/strategy-checker.ts:36-38; v1-src/agent/tools/deals/verify-payment.ts:103; v1-src/deals/executor.ts:91-94` | [#178](https://github.com/xlabtg/teleton-agent-v2/issues/178) |
| 33 | Exec scope "allowlist" silently maps to admin-only and the configured user allowlist is never enforced | `security` | `v1` | `v1-src/agent/tools/exec/module.ts:15-24; v1-src/config/schema.ts:312-319` | [#179](https://github.com/xlabtg/teleton-agent-v2/issues/179) |
| 34 | Management API binds all interfaces with an allow-all IP default and exposes /wallet/generate returning a mnemonic | `security` | `v1` | `v1-src/api/server.ts:424-433; v1-src/config/schema.ts:234-237; v1-src/webui/routes/setup.ts:242-257` | [#180](https://github.com/xlabtg/teleton-agent-v2/issues/180) |

## 🟡 MEDIUM (58)

| # | Title | Category | Component | Location | Issue |
|---|-------|----------|-----------|----------|-------|
| 1 | Checkpoint subsystem is write-only — load/resume is never implemented or called | `reliability` | `agents` | `packages/agents/src/checkpoint-store.ts:73-77` | [#126](https://github.com/xlabtg/teleton-agent-v2/issues/126) |
| 2 | Result aggregator's documented majority success rule is actually at-least-one-succeeded | `correctness` | `agents` | `packages/agents/src/result-aggregator.ts:33-63` | [#127](https://github.com/xlabtg/teleton-agent-v2/issues/127) |
| 3 | Result aggregator totalDurationMs sums per-subtask durations, overstating wall-clock time for parallel runs | `correctness` | `agents` | `packages/agents/src/result-aggregator.ts:13-72` | [#128](https://github.com/xlabtg/teleton-agent-v2/issues/128) |
| 4 | SelfCorrection ignores the classifier's suggestedMaxRetries | `correctness` | `agents` | `packages/agents/src/self-correction.ts:84-125` | [#129](https://github.com/xlabtg/teleton-agent-v2/issues/129) |
| 5 | Stale _rateLimitBackoffMs persists in shared context and delays later unrelated correction attempts | `correctness` | `agents` | `packages/agents/src/self-correction.ts:149-161` | [#130](https://github.com/xlabtg/teleton-agent-v2/issues/130) |
| 6 | Discovery findBest can rank a degraded agent above a healthy one and diverges from the router's scoring | `correctness` | `agents` | `packages/agents/src/discovery-service.ts:92-110` | [#131](https://github.com/xlabtg/teleton-agent-v2/issues/131) |
| 7 | CORS config is created and validated but never applied as middleware | `bug` | `api` | `packages/api/src/server.ts:128-160` | [#63](https://github.com/xlabtg/teleton-agent-v2/issues/63) |
| 8 | Refresh tokens carry no `type` claim and are accepted as access tokens | `security` | `api` | `packages/api/src/routes/auth.ts:28-40` | [#64](https://github.com/xlabtg/teleton-agent-v2/issues/64) |
| 9 | Body-size limit only inspects `Content-Length` and is bypassed by chunked/missing header | `security` | `api` | `packages/api/src/middleware/security.middleware.ts:195-207` | [#65](https://github.com/xlabtg/teleton-agent-v2/issues/65) |
| 10 | `startServer` registers no `error` handler, so port-in-use never settles the start promise | `reliability` | `api` | `packages/api/src/server.ts:85-123` | [#66](https://github.com/xlabtg/teleton-agent-v2/issues/66) |
| 11 | Swagger UI at `/api/docs` is blocked by the global CSP (CDN + inline scripts) | `bug` | `api` | `packages/api/src/middleware/security.middleware.ts:151` | [#67](https://github.com/xlabtg/teleton-agent-v2/issues/67) |
| 12 | Central error handler discards `ValidationError.details`, hiding which field failed | `error-handling` | `api` | `packages/api/src/middleware/error-handler.ts:18-31` | [#68](https://github.com/xlabtg/teleton-agent-v2/issues/68) |
| 13 | `/api/auth/login` accepts any credentials and mints a privileged token | `security` | `api` | `packages/api/src/routes/auth.ts:66-104` | [#69](https://github.com/xlabtg/teleton-agent-v2/issues/69) |
| 14 | CSRF cookie is never marked `Secure`; the agent passes no CSRF config | `security` | `api` | `apps/agent/src/index.ts:62-76` | [#70](https://github.com/xlabtg/teleton-agent-v2/issues/70) |
| 15 | No `unhandledRejection`/`uncaughtException` handlers; shutdown closes no resources | `reliability` | `api` | `apps/agent/src/index.ts:85-94` | [#71](https://github.com/xlabtg/teleton-agent-v2/issues/71) |
| 16 | install.sh is delivered via curl \| bash with no checksum or signature verification | `security` | `build` | `install.sh:6,60,75,101` | [#192](https://github.com/xlabtg/teleton-agent-v2/issues/192) |
| 17 | install.sh suggests sudo npm install -g, running a network install as root | `security` | `build` | `install.sh:68` | [#193](https://github.com/xlabtg/teleton-agent-v2/issues/193) |
| 18 | Release workflow publishes a mutable :latest Docker tag with no immutable digest reference | `ci-cd` | `build` | `.github/workflows/release.yml:32-38` | [#194](https://github.com/xlabtg/teleton-agent-v2/issues/194) |
| 19 | First-party GitHub Actions are pinned to mutable major tags rather than commit SHAs | `supply-chain` | `build` | `.github/workflows/ci.yml:18-19` | [#195](https://github.com/xlabtg/teleton-agent-v2/issues/195) |
| 20 | Repository has no Dependabot configuration and no CODEOWNERS file | `supply-chain` | `build` | `.github/` | [#196](https://github.com/xlabtg/teleton-agent-v2/issues/196) |
| 21 | audit-ci.jsonc allowlists 16 advisories, suppressing known vulnerabilities in CI | `supply-chain` | `build` | `audit-ci.jsonc:3-20` | [#197](https://github.com/xlabtg/teleton-agent-v2/issues/197) |
| 22 | processMessage mutates the caller's messages array in place | `bug` | `core` | `packages/core/src/usecases/agent-runtime.ts:116-128` | [#91](https://github.com/xlabtg/teleton-agent-v2/issues/91) |
| 23 | getRegisteredTools returns empty parameters, discarding real tool schemas | `correctness` | `core` | `packages/core/src/usecases/agent-runtime.ts:51-58` | [#92](https://github.com/xlabtg/teleton-agent-v2/issues/92) |
| 24 | SQLite connections set no busy_timeout and are never closed on shutdown | `reliability` | `infra` | `packages/infrastructure/src/database/sqlite.adapter.ts:35-44` | [#93](https://github.com/xlabtg/teleton-agent-v2/issues/93) |
| 25 | Credentials are stored in plaintext and returned by reference, allowing external mutation | `security` | `integrations` `security` | `packages/integrations/src/credential-manager.ts:78-96,132-139` | [#140](https://github.com/xlabtg/teleton-agent-v2/issues/140) |
| 26 | Dead-letter queue never removes permanently-failed entries, causing unbounded retention | `resource-leak` | `integrations` | `packages/integrations/src/dead-letter-queue.ts:121-193` | [#141](https://github.com/xlabtg/teleton-agent-v2/issues/141) |
| 27 | HTTP adapter follows redirects while forwarding the Authorization header to the redirect target | `security` | `integrations` `security` | `packages/integrations/src/api-adapter.ts:98-132` | [#142](https://github.com/xlabtg/teleton-agent-v2/issues/142) |
| 28 | EventStore.compact assumes events are already sorted by time and stops at the first recent event | `correctness` | `integrations` | `packages/integrations/src/event-store.ts:82-154` | [#143](https://github.com/xlabtg/teleton-agent-v2/issues/143) |
| 29 | Credential manager seeds empty-string env credentials as if present, masking missing-credential errors | `bug` | `integrations` | `packages/integrations/src/credential-manager.ts:141-153` | [#144](https://github.com/xlabtg/teleton-agent-v2/issues/144) |
| 30 | Weekly dayOfWeek and monthly dayOfMonth are ignored when advancing the next occurrence | `correctness` | `intelligence` | `packages/intelligence/src/schedule-store.ts:294-316` | [#111](https://github.com/xlabtg/teleton-agent-v2/issues/111) |
| 31 | CacheKeyGenerator store is unbounded and performs an O(n) embedding scan on every lookup | `performance` | `intelligence` | `packages/intelligence/src/cache-key-generator.ts:33-88` | [#112](https://github.com/xlabtg/teleton-agent-v2/issues/112) |
| 32 | AlertRouter.alertHistory grows without bound | `resource-leak` | `intelligence` | `packages/intelligence/src/alert-router.ts:38,71-78` | [#113](https://github.com/xlabtg/teleton-agent-v2/issues/113) |
| 33 | Anomaly alert threshold always reports the upper z-score bound, mislabeling low-side anomalies | `correctness` | `intelligence` | `packages/intelligence/src/anomaly-detector.ts:81-112` | [#114](https://github.com/xlabtg/teleton-agent-v2/issues/114) |
| 34 | "every 0 days"/"every 0 weeks" is accepted and produces a non-advancing schedule that re-fires every poll | `reliability` | `intelligence` | `packages/intelligence/src/schedule-parser.ts:163-180` | [#115](https://github.com/xlabtg/teleton-agent-v2/issues/115) |
| 35 | recordOutcome throws and loses the outcome when its usage record was FIFO-evicted | `error-handling` | `learning` | `packages/learning/src/prompt-tracker.ts:67-69,79-82` | [#154](https://github.com/xlabtg/teleton-agent-v2/issues/154) |
| 36 | Prompt optimizer auto-promotes variants from unauthenticated outcome scores (score poisoning) | `security` | `learning` | `packages/learning/src/prompt-optimizer.ts:95-168` | [#157](https://github.com/xlabtg/teleton-agent-v2/issues/157) |
| 37 | PromptComposer.interpolate injects context values verbatim (prompt injection via template values) | `security` | `learning` | `packages/learning/src/prompt-composer.ts:47-52` | [#160](https://github.com/xlabtg/teleton-agent-v2/issues/160) |
| 38 | mergeDuplicates/transferEdges creates duplicate edges with no de-duplication | `correctness` | `memory` | `packages/memory/src/graph-maintenance.ts:178-202` | [#101](https://github.com/xlabtg/teleton-agent-v2/issues/101) |
| 39 | search records access frequency but never updates accessedAt, so recency/decay scoring never reflects reads | `correctness` | `memory` | `packages/memory/src/memory-manager.ts:110-113` | [#102](https://github.com/xlabtg/teleton-agent-v2/issues/102) |
| 40 | CachedEmbeddingProvider evicts FIFO (not LRU) and performs no embedding-dimension validation | `correctness` | `memory` | `packages/memory/src/embedding-provider.ts:27-34,75-84` | [#103](https://github.com/xlabtg/teleton-agent-v2/issues/103) |
| 41 | cosineSimilarity returns 0 for zero vectors and the default 0.0 threshold silently drops negative-similarity matches | `correctness` | `memory` | `packages/memory/src/vector-store.ts:52-53,96-101` | [#104](https://github.com/xlabtg/teleton-agent-v2/issues/104) |
| 42 | In-memory vector and graph stores are unbounded, and compaction leaves orphaned vector entries in the index | `resource-leak` | `memory` | `packages/memory/src/vector-store.ts:62-85` | [#105](https://github.com/xlabtg/teleton-agent-v2/issues/105) |
| 43 | ContextSerializer.merge does not dedupe conversation history, duplicating messages on re-merge | `correctness` | `network` | `packages/network/src/context-serializer.ts:168-180` | [#155](https://github.com/xlabtg/teleton-agent-v2/issues/155) |
| 44 | ContextSerializer deserializes untrusted snapshots without schema validation | `security` | `network` | `packages/network/src/context-serializer.ts:152-180` | [#156](https://github.com/xlabtg/teleton-agent-v2/issues/156) |
| 45 | sanitizeControlChars strips only ASCII control chars; zero-width/bidi/Unicode controls survive | `security` | `security` | `packages/security/src/input-validator.ts:104-110` | [#79](https://github.com/xlabtg/teleton-agent-v2/issues/79) |
| 46 | Input length limit counts UTF-16 code units, not bytes — multi-byte payloads bypass byte limit | `correctness` | `security` | `packages/security/src/input-validator.ts:15-16,49,99-101` | [#80](https://github.com/xlabtg/teleton-agent-v2/issues/80) |
| 47 | Custom injection patterns with /g or /y flags carry lastIndex state across calls (non-deterministic matches) | `bug` | `security` | `packages/security/src/injection-detector.ts:88-91,101-105` | [#81](https://github.com/xlabtg/teleton-agent-v2/issues/81) |
| 48 | Built-in injection patterns are narrow and easily bypassed yet used as a primary control | `security` | `security` | `packages/security/src/injection-detector.ts:56-76` | [#82](https://github.com/xlabtg/teleton-agent-v2/issues/82) |
| 49 | Audit logging is fire-and-forget with a silent default onError → audit events silently lost | `reliability` | `security` | `packages/security/src/audit-logger.ts:25-26,55-70` | [#83](https://github.com/xlabtg/teleton-agent-v2/issues/83) |
| 50 | DashboardStreamer retains per-dashboard buffers forever (Map never pruned on unsubscribe) | `resource-leak` | `ui` | `packages/ui/src/dashboard-streamer.ts:72,202-211` | [#158](https://github.com/xlabtg/teleton-agent-v2/issues/158) |
| 51 | DataAnalyzer applies the numeric threshold to date columns, misclassifying them | `bug` | `ui` | `packages/ui/src/data-analyzer.ts:201` | [#159](https://github.com/xlabtg/teleton-agent-v2/issues/159) |
| 52 | Workspace path validator does not resolve symlinks before the containment check (symlink escape) | `security` | `v1` | `v1-src/workspace/validator.ts:97-142` | [#181](https://github.com/xlabtg/teleton-agent-v2/issues/181) |
| 53 | ton_send tool has no bounce parameter and never passes it, so transfers default to bounceable | `bug` | `v1` | `v1-src/agent/tools/ton/send.ts:19-33,60; v1-src/ton/transfer.ts:24` | [#182](https://github.com/xlabtg/teleton-agent-v2/issues/182) |
| 54 | sendTon fabricates a pseudo transaction hash instead of the real on-chain hash, corrupting deal records | `correctness` | `v1` | `v1-src/ton/transfer.ts:87-91; v1-src/deals/executor.ts:91-122` | [#183](https://github.com/xlabtg/teleton-agent-v2/issues/183) |
| 55 | exec_install and exec_service build bash -c strings from unsanitized input (command injection) | `security` | `v1` | `v1-src/agent/tools/exec/install.ts:13-18,51; v1-src/agent/tools/exec/service.ts:42; v1-src/agent/tools/exec/runner.ts:20` | [#184](https://github.com/xlabtg/teleton-agent-v2/issues/184) |
| 56 | Sessions list search/filter has a stale-response race that can overwrite newer results | `correctness` | `web` | `web/src/pages/Sessions.tsx:305-334` | [#164](https://github.com/xlabtg/teleton-agent-v2/issues/164) |
| 57 | ProviderStep effects capture a stale `data` prop, dropping concurrent field edits | `correctness` | `web` | `web/src/components/setup/ProviderStep.tsx:30-64` | [#166](https://github.com/xlabtg/teleton-agent-v2/issues/166) |
| 58 | Auth token is passed in the URL query string during the setup→dashboard handoff | `security` | `web` | `web/src/components/setup/SetupContext.tsx:248, web/src/App.tsx:51-65` | [#168](https://github.com/xlabtg/teleton-agent-v2/issues/168) |

## 🟢 LOW (45)

| # | Title | Category | Component | Location | Issue |
|---|-------|----------|-----------|----------|-------|
| 1 | Health checker flips degraded back to healthy on a single successful probe, masking flapping | `reliability` | `agents` | `packages/agents/src/health-checker.ts:108-132` | [#132](https://github.com/xlabtg/teleton-agent-v2/issues/132) |
| 2 | Health checker setInterval can overlap itself when a check round runs longer than the interval | `reliability` | `agents` | `packages/agents/src/health-checker.ts:64-94` | [#133](https://github.com/xlabtg/teleton-agent-v2/issues/133) |
| 3 | Default decomposition strategy derives requiredCapability from the task name without validation | `correctness` | `agents` | `packages/agents/src/task-decomposer.ts:58-84` | [#134](https://github.com/xlabtg/teleton-agent-v2/issues/134) |
| 4 | Pipeline paused and step skipped states are defined but never produced | `architecture` | `agents` | `packages/agents/src/pipeline-state.ts:8-16,67-74` | [#135](https://github.com/xlabtg/teleton-agent-v2/issues/135) |
| 5 | Health checker mutates registry from a stale agent snapshot across awaits, and timestamps are Date despite documented ISO-8601 strings | `concurrency` | `agents` | `packages/agents/src/health-checker.ts:85-94` | [#136](https://github.com/xlabtg/teleton-agent-v2/issues/136) |
| 6 | JWT secret has no minimum-strength validation and silently falls back to a random UUID | `security` | `api` | `configs/config.schema.ts:50` | [#72](https://github.com/xlabtg/teleton-agent-v2/issues/72) |
| 7 | Auth skip-list uses unbounded `/api/docs` prefix and contains a dead `/api/health` rule | `security` | `api` | `packages/api/src/middleware/auth.middleware.ts:71-78` | [#73](https://github.com/xlabtg/teleton-agent-v2/issues/73) |
| 8 | `requestId` reflects an unvalidated `x-request-id` header into responses and logs | `security` | `api` | `packages/api/src/middleware/security.middleware.ts:212-219` | [#74](https://github.com/xlabtg/teleton-agent-v2/issues/74) |
| 9 | PR template instructs targeting a nonexistent dev branch; SECURITY.md points to the wrong repo URL | `ci-cd` | `build` | `.github/PULL_REQUEST_TEMPLATE.md:16` | [#199](https://github.com/xlabtg/teleton-agent-v2/issues/199) |
| 10 | registerAdapter types the implementation as any, bypassing the DI cradle type check | `type-safety` | `core` | `packages/core/src/ports/di.container.ts:93-100` | [#96](https://github.com/xlabtg/teleton-agent-v2/issues/96) |
| 11 | AgentOrchestrator.processPendingTasks re-creates duplicate tasks and never executes the pending ones | `bug` | `core` | `packages/core/src/usecases/agent-orchestrator.ts:74-87` | [#97](https://github.com/xlabtg/teleton-agent-v2/issues/97) |
| 12 | docker/rvc image runs as root, uses a floating base tag, and has no HEALTHCHECK | `security` | `docker` | `docker/rvc/Dockerfile:4-34` | [#198](https://github.com/xlabtg/teleton-agent-v2/issues/198) |
| 13 | .dockerignore does not exclude *.pem / *.key, risking secret leakage into build context | `security` | `docker` | `.dockerignore:1-22` | [#200](https://github.com/xlabtg/teleton-agent-v2/issues/200) |
| 14 | searchByEmbedding selects the vector distance but discards it, exposing no relevance score | `correctness` | `infra` | `packages/infrastructure/src/database/sqlite.adapter.ts:170-188` | [#94](https://github.com/xlabtg/teleton-agent-v2/issues/94) |
| 15 | EnvSecretsAdapter.delete cannot remove env-provided secrets and set is non-persistent | `bug` | `infra` | `packages/infrastructure/src/secrets/env.adapter.ts:17-31` | [#95](https://github.com/xlabtg/teleton-agent-v2/issues/95) |
| 16 | Circuit breaker getters mutate state (side effects in property accessors) | `architecture` | `integrations` | `packages/integrations/src/circuit-breaker.ts:96-113` | [#145](https://github.com/xlabtg/teleton-agent-v2/issues/145) |
| 17 | Dead-letter queue replay swallows the underlying error, returning only a boolean | `error-handling` | `integrations` | `packages/integrations/src/dead-letter-queue.ts:132-145` | [#146](https://github.com/xlabtg/teleton-agent-v2/issues/146) |
| 18 | On a HALF_OPEN trial, CircuitBreaker.call runs the full retry loop instead of a single probe | `correctness` | `integrations` | `packages/integrations/src/circuit-breaker.ts:119-190` | [#147](https://github.com/xlabtg/teleton-agent-v2/issues/147) |
| 19 | EventStore.import allows duplicate ids within the imported batch (stale dedup snapshot) | `correctness` | `integrations` | `packages/integrations/src/event-store.ts:186-193` | [#148](https://github.com/xlabtg/teleton-agent-v2/issues/148) |
| 20 | ScheduleParser confidence penalty for missing intent is dead code | `correctness` | `intelligence` | `packages/intelligence/src/schedule-parser.ts:116-148` | [#116](https://github.com/xlabtg/teleton-agent-v2/issues/116) |
| 21 | Bare/"next" weekday resolution always skips the current day even when the requested time is still ahead | `correctness` | `intelligence` | `packages/intelligence/src/time-parser.ts:103-108,183-202` | [#117](https://github.com/xlabtg/teleton-agent-v2/issues/117) |
| 22 | UNIT_MS approximates month and year as fixed 30/365 days, causing date drift | `correctness` | `intelligence` | `packages/intelligence/src/time-parser.ts:51-59` | [#118](https://github.com/xlabtg/teleton-agent-v2/issues/118) |
| 23 | Baseline stdDev uses population variance (÷n) instead of sample variance (÷n−1) | `correctness` | `intelligence` | `packages/intelligence/src/baseline-profiler.ts:71-73` | [#119](https://github.com/xlabtg/teleton-agent-v2/issues/119) |
| 24 | cosineSimilarity silently ignores trailing dimensions on length mismatch | `correctness` | `intelligence` | `packages/intelligence/src/cache-key-generator.ts:94-107` | [#120](https://github.com/xlabtg/teleton-agent-v2/issues/120) |
| 25 | PredictiveCache.set never bounds the store; only lazy expiry reclaims memory | `resource-leak` | `intelligence` | `packages/intelligence/src/predictive-cache.ts:30-107` | [#121](https://github.com/xlabtg/teleton-agent-v2/issues/121) |
| 26 | indexBatch is O(n^2) due to repeated indexOf lookups | `performance` | `memory` | `packages/memory/src/semantic-search.ts:48-76` | [#106](https://github.com/xlabtg/teleton-agent-v2/issues/106) |
| 27 | Pattern entity-extractor regex misses acronyms/non-ASCII and builds O(n^2) all-pairs relations | `correctness` | `memory` | `packages/memory/src/entity-extractor.ts:44-83` | [#107](https://github.com/xlabtg/teleton-agent-v2/issues/107) |
| 28 | getNode mutates accessedAt on read, making reads non-idempotent and inconsistent with search | `correctness` | `memory` | `packages/memory/src/graph-store.ts:81-87` | [#108](https://github.com/xlabtg/teleton-agent-v2/issues/108) |
| 29 | handleConfirm uses raw string equality instead of the protocol compatibility check | `bug` | `network` | `packages/network/src/handshake.ts:349-358` | [#162](https://github.com/xlabtg/teleton-agent-v2/issues/162) |
| 30 | Message, correlation, and session IDs use Date.now()+Math.random(), not a cryptographic source | `security` | `network` | `packages/network/src/message-schema.ts:190-193` | [#163](https://github.com/xlabtg/teleton-agent-v2/issues/163) |
| 31 | AuthorizationMiddleware lacks hierarchical wildcards and fails open when denyByDefault is false | `security` | `security` | `packages/security/src/authorization-middleware.ts:95,121-128` | [#84](https://github.com/xlabtg/teleton-agent-v2/issues/84) |
| 32 | Denied consume persists premature window resets, and unban leaves stale violation state | `correctness` | `security` | `packages/security/src/rate-limiter.ts:105-127,168-173` | [#85](https://github.com/xlabtg/teleton-agent-v2/issues/85) |
| 33 | AutoWidgets.buildSpec switch has no default and silently returns undefined for unknown kinds | `type-safety` | `ui` | `packages/ui/src/auto-widgets.ts:113-161` | [#161](https://github.com/xlabtg/teleton-agent-v2/issues/161) |
| 34 | WebUI accepts the auth token via ?token= query string (leaks via logs and browser history) | `security` | `v1` | `v1-src/webui/server.ts:220-224` | [#185](https://github.com/xlabtg/teleton-agent-v2/issues/185) |
| 35 | ~/.teleton data directory is created without a restrictive (0700) mode | `security` | `v1` | `v1-src/workspace/manager.ts:57-66` | [#186](https://github.com/xlabtg/teleton-agent-v2/issues/186) |
| 36 | SSE EventSource connections omit withCredentials, dropping auth when served cross-origin | `reliability` | `web` | `web/src/lib/api.ts:1267,1371` | [#165](https://github.com/xlabtg/teleton-agent-v2/issues/165) |
| 37 | react-router 6.30.3 is within the open-redirect advisory range (GHSA-2j2x-hqr9-3h42) | `supply-chain` | `web` `build` | `web/package.json:27, web/package-lock.json:3570-3588` | [#167](https://github.com/xlabtg/teleton-agent-v2/issues/167) |
| 38 | fetchAPI sends cookies but never attaches the CSRF token the server expects | `security` | `web` | `web/src/lib/api.ts:603-621` | [#169](https://github.com/xlabtg/teleton-agent-v2/issues/169) |
| 39 | Trigger and rule deletions fire immediately with no confirmation prompt | `reliability` | `web` | `web/src/pages/Hooks.tsx:129-136,197-204` | [#170](https://github.com/xlabtg/teleton-agent-v2/issues/170) |
| 40 | useConfigState auto-persists the model to the server on provider change without explicit save | `correctness` | `web` | `web/src/hooks/useConfigState.ts:98-109` | [#171](https://github.com/xlabtg/teleton-agent-v2/issues/171) |
| 41 | ErrorBoundary renders a fallback but never logs or reports the caught error | `error-handling` | `web` | `web/src/components/ErrorBoundary.tsx:12-33` | [#172](https://github.com/xlabtg/teleton-agent-v2/issues/172) |
| 42 | DashboardGrid trusts localStorage layout shape without schema validation | `correctness` | `web` | `web/src/components/widgets/DashboardGrid.tsx:128-136,179-185` | [#173](https://github.com/xlabtg/teleton-agent-v2/issues/173) |
| 43 | Setup wizard accepts malformed Telegram api_hash (length-only check) | `correctness` | `web` | `web/src/components/setup/SetupContext.tsx:132` | [#174](https://github.com/xlabtg/teleton-agent-v2/issues/174) |
| 44 | Budget save silently coerces invalid/partial input to null instead of rejecting it | `error-handling` | `web` | `web/src/pages/Analytics.tsx:564-575` | [#175](https://github.com/xlabtg/teleton-agent-v2/issues/175) |
| 45 | Config import validates only the version tag, not the imported payload shape | `reliability` | `web` | `web/src/components/ExportImportPanel.tsx:32-55` | [#176](https://github.com/xlabtg/teleton-agent-v2/issues/176) |

## Rejected / verified-safe

Suspected issues that were investigated and found **not** to be defects.

| Title | Component | Reason |
|-------|-----------|--------|
| InMemoryEventBus uses a redundant allSettled pattern | `core` | Verified safe — not a defect. In publish() (packages/infrastructure/src/events/in-memory-event-bus.ts:12-23) each handler invocation is individually wrapped in `.catch()` that logs and swallows the error, so every element of the `promises` array always resolves; `Promise.allSettled(promises)` then awaits all of them. Handler isolation is therefore already correct: a throwing/rejecting handler logs its error and does NOT prevent the other handlers from running or cause publish() to reject, and publish() still awaits completion of every handler. The only observation is that `allSettled` is interchangeable with `Promise.all` here (since the per-handler `.catch()` already guarantees no rejection) — a harmless stylistic redundancy, not a reliability bug. No code change is warranted. |
| API gateway never records downstream failures into the circuit breaker, so the breaker never opens | `integrations` | The breaker records downstream failures itself: the gateway wraps every call in `breaker.call(...)`, and `CircuitBreaker.call` invokes `_onFailure()` on exhausted attempts, which increments `failureCount` and opens the circuit at `failureThreshold`. No separate failure-recording in the gateway is needed (or correct); a persistently failing adapter does open the breaker. |
| Main Dockerfile leaves build toolchain in the final image (bloat / attack surface) | `docker` | The runtime stage explicitly removes the build toolchain. After installing production deps (Dockerfile:48-50, which need python3/make/g++ to compile native modules such as better-sqlite3), Dockerfile:53 runs `RUN apt-get purge -y python3 make g++ && apt-get autoremove -y`, so python3/make/g++ are not present in the final image's top filesystem layer. The build toolchain that IS installed only for compilation lives in the separate `build` stage (Dockerfile:7-11), which is discarded and never copied into the runtime stage (only `dist/` and `configs/` are copied via `COPY --from=build`). The finding's premise — that the final image retains the build toolchain — does not hold against the current code. (Minor, non-defect note: because the purge at line 53 is a separate RUN layer from the install at line 48-50, the toolchain still occupies intermediate layer history and so does not shrink the image as much as installing+purging in a single RUN would; this is a marginal size optimization, not the security/bloat defect described, and removing the runtime toolchain entirely would break the native-module rebuild, so the minimal-fix constraint precludes simply deleting it.) |

