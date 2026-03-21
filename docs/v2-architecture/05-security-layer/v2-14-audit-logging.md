# V2-14: Comprehensive Audit Logging

## Overview
Build a structured audit logging system that records all significant agent actions, decisions, and data access events for security monitoring, compliance, and debugging.

## Current State
V1 uses basic console logging with no structured format, no centralized storage, and no query capability. Critical events are mixed with debug noise.

## Problem
Without comprehensive audit logs, it is impossible to investigate security incidents, demonstrate compliance, or debug production issues effectively. Unstructured logs are difficult to query and analyze.

## What to Implement
- Structured log event schema with standard fields (actor, action, resource, outcome)
- Tamper-evident log storage with integrity verification
- Configurable log levels and filtering by category
- Log query API with time range, actor, and action filters
- Retention policies with automatic archival and deletion

## Implementation Steps
1. Define the audit event schema covering all loggable action categories
2. Build a logging middleware that captures events at key system boundaries
3. Implement a log store with append-only semantics and integrity hashing
4. Create a query API with filtering, pagination, and export support
5. Add retention policy management with configurable TTLs per log category
6. Integrate with external SIEM systems via standard formats (CEF, JSON)

## Files to Create/Modify
- `packages/security/src/audit-logger.ts`
- `packages/security/src/audit-event.ts`
- `packages/security/src/audit-store.ts`
- `packages/security/src/audit-query.ts`

## Dependencies
- None (foundational component used by most other modules)

## Notes
- Audit logs must never contain raw secrets or PII; redact sensitive fields
- Log integrity is critical; consider hash chaining or write-once storage
- Plan for high write throughput; batch writes and use async I/O
