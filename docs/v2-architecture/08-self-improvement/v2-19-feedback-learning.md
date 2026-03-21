# V2-19: Feedback-Based Learning

## Overview
Implement a feedback collection and learning system that captures user satisfaction signals and uses them to improve agent behavior over time without retraining the base model.

## Current State
V1 does not collect or act on user feedback. Every interaction produces the same quality regardless of historical success or failure patterns.

## Problem
Without feedback loops, the agent repeats the same mistakes and cannot adapt to user preferences or domain-specific requirements. Improvement requires manual prompt engineering.

## What to Implement
- Multi-signal feedback collection (explicit ratings, implicit signals like retries and edits)
- Feedback-to-behavior mapping that identifies which actions need improvement
- Strategy adjustment engine that modifies prompts, tool selection, and routing based on feedback
- A/B testing framework for comparing strategy variants
- Feedback analytics dashboard for monitoring improvement trends

## Implementation Steps
1. Define feedback event types covering explicit (thumbs up/down) and implicit signals
2. Build a feedback store with association to the originating interaction
3. Implement a feedback analyzer that identifies patterns in negative feedback
4. Create a strategy adjustment module that updates prompt templates and tool preferences
5. Add A/B testing support with traffic splitting and statistical significance tracking
6. Build analytics queries for feedback trends by category, time, and agent

## Files to Create/Modify
- `packages/learning/src/feedback-collector.ts`
- `packages/learning/src/feedback-analyzer.ts`
- `packages/learning/src/strategy-adjuster.ts`
- `packages/learning/src/ab-testing.ts`

## Dependencies
- V2-14 (Audit Logging) for correlating feedback with specific actions
- V2-20 (Dynamic Prompts) for applying learned improvements to prompts

## Notes
- Implicit feedback signals (retries, rephrasing) are often more honest than explicit ratings
- Guard against feedback gaming; validate that adjustments actually improve outcomes
- Keep a rollback capability for strategy changes that degrade performance
