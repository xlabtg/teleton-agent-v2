/**
 * Behavior tracker for the prediction engine.
 * Records behavioral events (user actions, timing, context) to build
 * a history that the pattern miner can analyse.
 */

export type ActionType =
  | "message_sent"
  | "command_invoked"
  | "tool_used"
  | "session_started"
  | "session_ended"
  | "query_submitted"
  | "response_accepted"
  | "response_rejected";

export interface BehavioralEvent {
  id: string;
  userId: string;
  action: ActionType;
  /** Freeform context (command name, tool name, query text, etc.) */
  context: Record<string, unknown>;
  timestamp: Date;
}

export interface BehaviorTrackerConfig {
  /** Maximum number of events to retain per user. Oldest events are evicted. */
  maxEventsPerUser?: number;
  /** Whether to collect events (can be disabled for opt-out). */
  enabled?: boolean;
}

/**
 * In-memory store of behavioral events, grouped by userId.
 * Privacy-respecting: supports per-user opt-out and full data deletion.
 */
export class BehaviorTracker {
  private readonly events = new Map<string, BehavioralEvent[]>();
  private readonly optedOut = new Set<string>();
  private readonly maxEventsPerUser: number;
  private enabled: boolean;

  constructor(config: BehaviorTrackerConfig = {}) {
    this.maxEventsPerUser = config.maxEventsPerUser ?? 1000;
    this.enabled = config.enabled ?? true;
  }

  /**
   * Record a behavioral event for a user.
   * No-ops if tracking is globally disabled or the user has opted out.
   */
  record(event: Omit<BehavioralEvent, "id">): void {
    if (!this.enabled || this.optedOut.has(event.userId)) return;

    const stored: BehavioralEvent = {
      ...event,
      id: crypto.randomUUID(),
    };

    const userEvents = this.events.get(event.userId) ?? [];
    userEvents.push(stored);

    // Evict oldest events if limit exceeded
    if (userEvents.length > this.maxEventsPerUser) {
      userEvents.splice(0, userEvents.length - this.maxEventsPerUser);
    }

    this.events.set(event.userId, userEvents);
  }

  /**
   * Return all recorded events for a user, in chronological order.
   */
  getEvents(userId: string): BehavioralEvent[] {
    return this.events.get(userId) ?? [];
  }

  /**
   * Return events for a user within a time window.
   */
  getEventsInWindow(userId: string, since: Date, until: Date = new Date()): BehavioralEvent[] {
    return this.getEvents(userId).filter(
      (e) => e.timestamp >= since && e.timestamp <= until,
    );
  }

  /**
   * Return the total number of events recorded for a user.
   */
  getEventCount(userId: string): number {
    return (this.events.get(userId) ?? []).length;
  }

  /**
   * Opt a user out of behavior tracking and delete all their stored events.
   */
  optOut(userId: string): void {
    this.optedOut.add(userId);
    this.events.delete(userId);
  }

  /**
   * Re-enable behavior tracking for a user that previously opted out.
   */
  optIn(userId: string): void {
    this.optedOut.delete(userId);
  }

  /**
   * Check whether a user has opted out.
   */
  isOptedOut(userId: string): boolean {
    return this.optedOut.has(userId);
  }

  /**
   * Delete all recorded events for a user without opting them out.
   */
  reset(userId: string): void {
    this.events.delete(userId);
  }

  /**
   * Enable or disable tracking globally.
   */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /**
   * Return whether tracking is globally enabled.
   */
  isEnabled(): boolean {
    return this.enabled;
  }
}
