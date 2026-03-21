# V2-03: Importance-Based Memory Retention

## Overview
Implement a scoring and retention system that prioritizes important memories and gracefully forgets low-value ones. This keeps the memory store efficient while preserving critical context.

## Current State
V1 retains all memories equally or uses simple FIFO eviction. There is no distinction between a trivial exchange and a critical user preference.

## Problem
Unbounded memory growth degrades search quality and increases costs. Uniform eviction risks losing important context while retaining noise.

## What to Implement
- Multi-signal importance scoring (recency, frequency, emotional weight, explicit pins)
- Configurable retention policies with tiered storage (hot, warm, cold)
- Automatic decay function that reduces scores over time
- User-facing ability to pin or dismiss specific memories
- Background compaction job that summarizes and archives low-score clusters

## Implementation Steps
1. Define an importance score model combining recency, access frequency, and content signals
2. Implement a decay function that runs on a configurable schedule
3. Create retention tiers with different storage backends and retrieval latencies
4. Build a compaction pipeline that summarizes groups of low-importance memories
5. Add API endpoints for manual pin, unpin, and forget operations
6. Write monitoring for memory store size, score distribution, and eviction rates

## Files to Create/Modify
- `packages/memory/src/importance-scorer.ts`
- `packages/memory/src/retention-policy.ts`
- `packages/memory/src/compaction.ts`
- `packages/memory/src/memory-manager.ts`

## Dependencies
- V2-01 (Semantic Vector Memory) for similarity-based clustering during compaction
- V2-02 (Associative Graph Memory) for relationship-aware importance boosting

## Notes
- Importance scoring weights should be configurable per deployment
- Compaction summaries must preserve key facts; test with retrieval quality benchmarks
- Consider GDPR-style hard-delete support for compliance scenarios
