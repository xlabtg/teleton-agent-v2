# V2-11: Time-Aware Context Processing

## Overview
Add temporal awareness to the agent's context processing so it understands time references, deadlines, recency, and temporal relationships between events.

## Current State
V1 treats all context as timeless. It cannot distinguish between recent and stale information or understand relative time references like "last week" or "before the meeting."

## Problem
Without temporal awareness, the agent provides outdated information with the same confidence as current data. It cannot reason about sequences, deadlines, or time-sensitive priorities.

## What to Implement
- Temporal expression parser that resolves relative and absolute time references
- Time-weighted context scoring that prioritizes recent information
- Event timeline construction from conversation and memory data
- Deadline and urgency detection for prioritization
- Timezone-aware processing for multi-region users

## Implementation Steps
1. Integrate a temporal expression parser (e.g., chrono-node or custom NLP)
2. Add timestamp metadata to all context items and memory entries
3. Implement time-decay weighting in context retrieval and ranking
4. Build a timeline construction module that orders events chronologically
5. Create urgency detection rules based on deadline proximity
6. Add timezone normalization with user preference support

## Files to Create/Modify
- `packages/intelligence/src/temporal-context.ts`
- `packages/intelligence/src/time-parser.ts`
- `packages/intelligence/src/timeline-builder.ts`
- `packages/intelligence/src/urgency-detector.ts`

## Dependencies
- V2-01 (Semantic Vector Memory) for time-stamped memory retrieval
- V2-03 (Importance Retention) for recency-based importance scoring

## Notes
- Temporal parsing must handle ambiguous references gracefully with clarification prompts
- Time zone handling is critical for correctness; default to UTC internally
- Consider cultural date format differences in the parser
