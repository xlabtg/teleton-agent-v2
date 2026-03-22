/**
 * Notification Adapter — V2-12.
 * Delivers schedule trigger notifications through configurable channels
 * (in-app callback, webhook, or custom handler).
 * Callers register channel handlers; the adapter selects channels based on
 * the delivery config attached to each notification payload.
 */

import type { ScheduleEntry } from "./schedule-store.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationChannel = "in-app" | "webhook" | string;

export interface NotificationPayload {
  /** The schedule entry that triggered this notification. */
  entry: ScheduleEntry;
  /** When the notification was dispatched. */
  dispatchedAt: Date;
  /** True when the trigger was delayed past its scheduled time. */
  isLate: boolean;
}

export interface DeliveryResult {
  channel: NotificationChannel;
  success: boolean;
  /** Error message if success is false. */
  error?: string;
}

/**
 * A channel handler receives a payload and returns a promise that resolves
 * once delivery is complete. Throw (or reject) to signal a delivery failure.
 */
export type ChannelHandler = (payload: NotificationPayload) => Promise<void>;

export interface WebhookChannelConfig {
  /** URL to POST the payload to. */
  url: string;
  /** Optional HTTP headers (e.g. Authorization). */
  headers?: Record<string, string>;
}

export interface NotificationAdapterConfig {
  /**
   * Number of delivery attempts before giving up. Default: 3.
   */
  maxRetries?: number;
  /**
   * Base delay (ms) between retries using exponential back-off. Default: 500.
   */
  retryBaseMs?: number;
}

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

/**
 * Routes notification payloads to registered channel handlers.
 *
 * @example
 * const adapter = new NotificationAdapter();
 * adapter.registerHandler("in-app", async (payload) => {
 *   console.log("Reminder:", payload.entry.action);
 * });
 * await adapter.dispatch(payload, ["in-app"]);
 */
export class NotificationAdapter {
  private readonly handlers = new Map<NotificationChannel, ChannelHandler>();
  private readonly maxRetries: number;
  private readonly retryBaseMs: number;

  constructor(config: NotificationAdapterConfig = {}) {
    this.maxRetries = config.maxRetries ?? 3;
    this.retryBaseMs = config.retryBaseMs ?? 500;
  }

  /**
   * Register a handler for a named channel.
   * Replaces any previously registered handler for the same channel.
   */
  registerHandler(channel: NotificationChannel, handler: ChannelHandler): void {
    this.handlers.set(channel, handler);
  }

  /** Deregister a channel handler. */
  unregisterHandler(channel: NotificationChannel): void {
    this.handlers.delete(channel);
  }

  /** Return whether a handler is registered for the given channel. */
  hasHandler(channel: NotificationChannel): boolean {
    return this.handlers.has(channel);
  }

  /**
   * Register a simple webhook handler that POSTs the payload as JSON.
   * Requires a global `fetch` (Node ≥ 18 / any modern runtime).
   */
  registerWebhook(channel: NotificationChannel, webhookConfig: WebhookChannelConfig): void {
    this.registerHandler(channel, async (payload) => {
      const response = await fetch(webhookConfig.url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...webhookConfig.headers,
        },
        body: JSON.stringify({
          entryId: payload.entry.id,
          userId: payload.entry.userId,
          action: payload.entry.action,
          dispatchedAt: payload.dispatchedAt.toISOString(),
          isLate: payload.isLate,
        }),
      });
      if (!response.ok) {
        throw new Error(`Webhook returned HTTP ${response.status}`);
      }
    });
  }

  /**
   * Dispatch a notification payload to the specified channels.
   * Each channel is attempted independently; failures in one channel do not
   * block others. Retries with exponential back-off on transient errors.
   *
   * @returns Array of per-channel delivery results.
   */
  async dispatch(
    payload: NotificationPayload,
    channels: NotificationChannel[]
  ): Promise<DeliveryResult[]> {
    const results = await Promise.all(
      channels.map((channel) => this._deliverWithRetry(channel, payload))
    );
    return results;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async _deliverWithRetry(
    channel: NotificationChannel,
    payload: NotificationPayload
  ): Promise<DeliveryResult> {
    const handler = this.handlers.get(channel);
    if (!handler) {
      return {
        channel,
        success: false,
        error: `No handler registered for channel "${channel}"`,
      };
    }

    let lastError: string | undefined;
    for (let attempt = 0; attempt < this.maxRetries; attempt++) {
      try {
        await handler(payload);
        return { channel, success: true };
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (attempt < this.maxRetries - 1) {
          const delay = this.retryBaseMs * Math.pow(2, attempt);
          await this._sleep(delay);
        }
      }
    }

    return { channel, success: false, error: lastError };
  }

  private _sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
