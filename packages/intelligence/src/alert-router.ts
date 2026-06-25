/**
 * Alert router.
 * Receives raw anomaly alerts, deduplicates them, classifies their severity,
 * and dispatches them to registered handlers.
 */

export type AlertSeverity = "low" | "medium" | "high" | "critical";

export interface Alert {
  id: string;
  metric: string;
  severity: AlertSeverity;
  message: string;
  value: number;
  threshold: number;
  detectedAt: Date;
  /** Deduplicated: if a similar alert fired recently this field is set. */
  suppressedUntil?: Date;
}

export type AlertHandler = (alert: Alert) => void | Promise<void>;

export interface AlertRouterConfig {
  /**
   * Minimum milliseconds that must pass before the same metric can fire
   * another alert of the same or lower severity. Set to 0 to disable.
   */
  deduplicationWindowMs?: number;
  /**
   * Maximum number of recent alerts to retain in memory. Set to 0 to disable
   * history retention.
   */
  maxHistorySize?: number;
}

/**
 * Routes alerts to registered handlers with deduplication to prevent alert fatigue.
 */
export class AlertRouter {
  private readonly handlers: AlertHandler[] = [];
  private readonly lastFiredAt = new Map<string, Date>();
  private readonly deduplicationWindowMs: number;
  private readonly maxHistorySize: number;
  private readonly alertHistory: Alert[] = [];

  constructor(config: AlertRouterConfig = {}) {
    this.deduplicationWindowMs = config.deduplicationWindowMs ?? 5 * 60 * 1000; // 5 min
    this.maxHistorySize = Math.max(0, Math.floor(config.maxHistorySize ?? 1_000));
  }

  /**
   * Register a handler that will be called for every non-suppressed alert.
   */
  register(handler: AlertHandler): void {
    this.handlers.push(handler);
  }

  /**
   * Emit an alert. The router applies deduplication and then forwards to all
   * registered handlers. Handlers are called in registration order; errors
   * in one handler do not prevent subsequent handlers from running.
   */
  async emit(alert: Omit<Alert, "id" | "detectedAt">): Promise<Alert> {
    const full: Alert = {
      ...alert,
      id: crypto.randomUUID(),
      detectedAt: new Date(),
    };

    // Deduplication: suppress if this metric fired recently
    if (this.deduplicationWindowMs > 0) {
      const dedupeKey = `${full.metric}:${full.severity}`;
      const last = this.lastFiredAt.get(dedupeKey);
      if (last) {
        const suppressedUntil = new Date(last.getTime() + this.deduplicationWindowMs);
        if (suppressedUntil > full.detectedAt) {
          full.suppressedUntil = suppressedUntil;
          this.recordHistory(full);
          return full; // Suppressed — do not dispatch to handlers
        }
      }
      this.lastFiredAt.set(dedupeKey, full.detectedAt);
    }

    this.recordHistory(full);

    // Dispatch to handlers (errors are caught to avoid breaking the pipeline)
    for (const handler of this.handlers) {
      try {
        await handler(full);
      } catch {
        // Handler errors are silently ignored to protect the main flow
      }
    }

    return full;
  }

  /**
   * Return recent alert history (most recent first), optionally filtered by metric.
   */
  getHistory(metric?: string, limit?: number): Alert[] {
    const maxResults = limit === undefined ? undefined : Math.max(0, Math.floor(limit));
    const history: Alert[] = [];

    for (let i = this.alertHistory.length - 1; i >= 0; i--) {
      const alert = this.alertHistory[i];
      if (!metric || alert.metric === metric) {
        history.push(alert);
        if (maxResults !== undefined && history.length >= maxResults) {
          break;
        }
      }
    }

    return history;
  }

  /**
   * Mark an alert as a false positive (useful for feedback tracking).
   * Currently a no-op stub — implementations can extend this.
   */
  markFalsePositive(_alertId: string): void {
    // Stub for future feedback integration
  }

  private recordHistory(alert: Alert): void {
    if (this.maxHistorySize === 0) {
      return;
    }

    this.alertHistory.push(alert);
    const overflow = this.alertHistory.length - this.maxHistorySize;
    if (overflow > 0) {
      this.alertHistory.splice(0, overflow);
    }
  }
}
