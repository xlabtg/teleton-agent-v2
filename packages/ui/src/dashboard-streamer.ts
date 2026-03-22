/**
 * Dashboard streamer — V2-17.
 * Manages real-time update delivery for live dashboard content.
 * Uses an observer pattern: consumers subscribe to a dashboard id and receive
 * patch objects whenever data changes.  No network transport is included —
 * adapters wrap this class to emit SSE frames, WebSocket messages, etc.
 */

import type { DashboardLayout } from "./layout-engine.js";
import type { WidgetSpec } from "./widget-templates.js";

// ---------------------------------------------------------------------------
// Streaming types
// ---------------------------------------------------------------------------

/** The type of an update patch. */
export type PatchKind =
  | "layout_replaced"  // full layout was regenerated
  | "widget_added"     // a new widget slot was appended
  | "widget_removed"   // a widget was removed
  | "data_updated"     // the data for an existing widget changed
  | "heartbeat";       // keep-alive with no data change

/** A single patch sent to subscribers. */
export interface DashboardPatch {
  dashboardId: string;
  kind: PatchKind;
  /** ISO-8601 timestamp of this patch. */
  patchedAt: string;
  /** Full new layout (for layout_replaced). */
  layout?: DashboardLayout;
  /** Widget spec affected (for widget_added / widget_removed / data_updated). */
  widget?: WidgetSpec;
  /** Arbitrary data payload associated with a data_updated patch. */
  data?: unknown;
}

export type PatchHandler = (patch: DashboardPatch) => void;

export interface StreamSubscription {
  dashboardId: string;
  token: string;
}

// ---------------------------------------------------------------------------
// DashboardStreamer
// ---------------------------------------------------------------------------

export interface DashboardStreamerConfig {
  /**
   * How often (ms) to emit a heartbeat patch to all active subscriptions.
   * Pass 0 to disable heartbeats.  Default: 30 000 (30 s).
   */
  heartbeatIntervalMs?: number;
  /** Maximum number of patches to buffer per dashboard (ring buffer). Default: 100. */
  bufferSize?: number;
}

/**
 * Manages live update subscriptions for dashboard consumers.
 *
 * @example
 * const streamer = new DashboardStreamer();
 * const sub = streamer.subscribe("dash-1", (patch) => sendToClient(patch));
 * streamer.pushLayout("dash-1", newLayout);
 * streamer.unsubscribe(sub.token);
 * streamer.destroy();
 */
export class DashboardStreamer {
  private readonly handlers = new Map<
    string,
    Map<string, PatchHandler>
  >(); // dashboardId → (token → handler)
  private readonly tokenIndex = new Map<string, string>(); // token → dashboardId
  private readonly buffer = new Map<string, DashboardPatch[]>(); // dashboardId → patches
  private readonly bufferSize: number;
  private _tokenCounter = 0;
  private _heartbeatTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: DashboardStreamerConfig = {}) {
    this.bufferSize = config.bufferSize ?? 100;
    const heartbeatMs = config.heartbeatIntervalMs ?? 30_000;
    if (heartbeatMs > 0) {
      this._heartbeatTimer = setInterval(() => this.emitHeartbeats(), heartbeatMs);
    }
  }

  // ---------------------------------------------------------------------------
  // Subscribe / unsubscribe
  // ---------------------------------------------------------------------------

  /**
   * Subscribe to all patches for a specific dashboard.
   * Returns a token used to unsubscribe.
   */
  subscribe(dashboardId: string, handler: PatchHandler): StreamSubscription {
    const token = `stream-${Date.now()}-${++this._tokenCounter}`;
    if (!this.handlers.has(dashboardId)) {
      this.handlers.set(dashboardId, new Map());
    }
    this.handlers.get(dashboardId)!.set(token, handler);
    this.tokenIndex.set(token, dashboardId);
    return { dashboardId, token };
  }

  /**
   * Unsubscribe using the token returned by subscribe().
   * Returns true if the subscription was found and removed.
   */
  unsubscribe(token: string): boolean {
    const dashboardId = this.tokenIndex.get(token);
    if (!dashboardId) return false;
    const map = this.handlers.get(dashboardId);
    if (!map) return false;
    const removed = map.delete(token);
    this.tokenIndex.delete(token);
    if (map.size === 0) this.handlers.delete(dashboardId);
    return removed;
  }

  /** Number of active subscriptions across all dashboards. */
  get subscriptionCount(): number {
    let count = 0;
    for (const map of this.handlers.values()) count += map.size;
    return count;
  }

  // ---------------------------------------------------------------------------
  // Push updates
  // ---------------------------------------------------------------------------

  /** Push a full layout replacement for a dashboard. */
  pushLayout(dashboardId: string, layout: DashboardLayout): void {
    this.dispatch({
      dashboardId,
      kind: "layout_replaced",
      patchedAt: new Date().toISOString(),
      layout,
    });
  }

  /** Notify subscribers that a widget was added. */
  pushWidgetAdded(dashboardId: string, widget: WidgetSpec): void {
    this.dispatch({
      dashboardId,
      kind: "widget_added",
      patchedAt: new Date().toISOString(),
      widget,
    });
  }

  /** Notify subscribers that a widget was removed. */
  pushWidgetRemoved(dashboardId: string, widget: WidgetSpec): void {
    this.dispatch({
      dashboardId,
      kind: "widget_removed",
      patchedAt: new Date().toISOString(),
      widget,
    });
  }

  /** Push a data update for a specific widget. */
  pushDataUpdate(dashboardId: string, widget: WidgetSpec, data: unknown): void {
    this.dispatch({
      dashboardId,
      kind: "data_updated",
      patchedAt: new Date().toISOString(),
      widget,
      data,
    });
  }

  // ---------------------------------------------------------------------------
  // Buffer access
  // ---------------------------------------------------------------------------

  /**
   * Return buffered patches for a dashboard, optionally limited to the last N.
   * Useful for catch-up when a subscriber reconnects.
   */
  getBuffer(dashboardId: string, limit?: number): DashboardPatch[] {
    const patches = this.buffer.get(dashboardId) ?? [];
    return limit !== undefined ? patches.slice(-limit) : patches.slice();
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /** Stop heartbeat timers and clear all subscriptions. */
  destroy(): void {
    if (this._heartbeatTimer !== null) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this.handlers.clear();
    this.tokenIndex.clear();
    this.buffer.clear();
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private dispatch(patch: DashboardPatch): void {
    // Buffer patch (ring buffer)
    if (!this.buffer.has(patch.dashboardId)) {
      this.buffer.set(patch.dashboardId, []);
    }
    const buf = this.buffer.get(patch.dashboardId)!;
    buf.push(patch);
    if (buf.length > this.bufferSize) {
      buf.splice(0, buf.length - this.bufferSize);
    }

    // Deliver to subscribers
    const map = this.handlers.get(patch.dashboardId);
    if (!map) return;
    for (const handler of map.values()) {
      try {
        handler(patch);
      } catch {
        // Individual handler errors must not disrupt other subscribers.
      }
    }
  }

  private emitHeartbeats(): void {
    const now = new Date().toISOString();
    for (const dashboardId of this.handlers.keys()) {
      this.dispatch({ dashboardId, kind: "heartbeat", patchedAt: now });
    }
  }
}
