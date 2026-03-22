# V2-12: Smart Scheduling and Reminders

## Overview

Implement a scheduling system that can create, manage, and trigger reminders and scheduled tasks based on natural language instructions and contextual cues.

## Current State

V1 has no scheduling capability. Users cannot ask the agent to remind them of something or schedule a future action.

## Problem

Users must rely on external tools for scheduling and reminders, breaking the conversational flow. The agent cannot follow up on commitments or time-sensitive tasks.

## What to Implement

- Natural language schedule parsing ("remind me tomorrow at 9am")
- Persistent schedule store with trigger management
- Notification delivery through configurable channels
- Recurring schedule support with cron-like flexibility
- Conflict detection for overlapping scheduled items

## Implementation Steps

1. Build a schedule intent parser that extracts time, recurrence, and action from text
2. Create a persistent schedule store with indexing by trigger time
3. Implement a scheduler daemon that polls for due items and triggers actions
4. Add notification adapters for multiple delivery channels (in-app, email, webhook)
5. Support recurrence patterns using cron expressions or natural language rules
6. Build conflict detection that warns about overlapping or adjacent schedules

## Files to Create/Modify

- `packages/intelligence/src/smart-scheduler.ts`
- `packages/intelligence/src/schedule-parser.ts`
- `packages/intelligence/src/schedule-store.ts`
- `packages/intelligence/src/notification-adapter.ts`

## Dependencies

- V2-11 (Temporal Context) for time expression parsing
- V2-16 (Event-Driven Architecture) for trigger event emission

## Notes

- The scheduler daemon must be resilient to restarts; persist next-trigger times
- Support timezone-aware scheduling per user
- Missed triggers (e.g., during downtime) should fire on recovery with a "late" flag
