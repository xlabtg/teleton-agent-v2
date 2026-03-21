# V2-20: Dynamic Prompt Optimization

## Overview
Build a prompt management system that dynamically selects, composes, and optimizes prompts based on task context, user history, and performance feedback rather than using static prompt templates.

## Current State
V1 uses hardcoded prompt templates with minimal parameterization. Prompt changes require code deployments and affect all users uniformly.

## Problem
Static prompts cannot adapt to different user styles, domain contexts, or evolving best practices. Optimizing prompts requires manual experimentation with no systematic tracking of what works.

## What to Implement
- Prompt template registry with versioning and metadata
- Context-aware prompt composition that assembles prompts from modular sections
- Performance tracking per prompt variant with automated scoring
- Gradient-free optimization that evolves prompts based on outcome metrics
- Prompt A/B testing integrated with V2-19 feedback system

## Implementation Steps
1. Build a prompt registry with CRUD operations and version history
2. Implement a prompt composer that assembles final prompts from reusable sections
3. Add context injection that tailors prompt sections based on user and task metadata
4. Create a performance tracker that scores prompt variants by outcome quality
5. Implement an optimization loop that promotes high-performing variants
6. Add rollback support for reverting to previous prompt versions

## Files to Create/Modify
- `packages/learning/src/prompt-registry.ts`
- `packages/learning/src/prompt-composer.ts`
- `packages/learning/src/prompt-optimizer.ts`
- `packages/learning/src/prompt-tracker.ts`

## Dependencies
- V2-19 (Feedback Learning) for outcome quality signals
- V2-14 (Audit Logging) for prompt usage tracking

## Notes
- Never optimize prompts that affect safety or security guardrails
- Keep human-readable prompt diffs for review before promotion
- Consider per-user prompt personalization as an advanced feature
