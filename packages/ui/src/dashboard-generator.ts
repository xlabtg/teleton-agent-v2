/**
 * Dashboard generator — V2-17.
 * High-level orchestrator that turns a map of named data values into a fully
 * laid-out dashboard.  Combines AutoWidgets, LayoutEngine, WidgetRegistry, and
 * DashboardStreamer into a single entry point.
 *
 * The generator keeps a registry of user preferences per dashboard id so that
 * layout overrides persist across regenerations.
 */

import { AutoWidgets, type AutoWidgetHints, type AutoWidgetConfig } from "./auto-widgets.js";
import {
  LayoutEngine,
  type DashboardLayout,
  type LayoutContext,
  type LayoutEngineConfig,
} from "./layout-engine.js";
import { WidgetRegistry, type WidgetRegistryConfig } from "./widget-registry.js";
import { DashboardStreamer, type DashboardStreamerConfig } from "./dashboard-streamer.js";
import type { WidgetSpec } from "./widget-templates.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A named data entry fed into the generator. */
export interface DataEntry {
  /** Unique key used as both the widget id seed and the data binding key. */
  key: string;
  /** The actual data to analyze. */
  data: unknown;
  /** Optional widget generation hints for this entry. */
  hints?: AutoWidgetHints;
}

/** User preference overrides stored per dashboard. */
export interface DashboardPreferences {
  dashboardId: string;
  /** Per-widget spec overrides keyed by widget id. */
  widgetOverrides?: Record<string, Partial<WidgetSpec>>;
  /** Layout context overrides (e.g. pinned column count). */
  layoutContext?: LayoutContext;
  /** Custom dashboard title. */
  title?: string;
}

export interface DashboardGeneratorConfig {
  autoWidget?: AutoWidgetConfig;
  layout?: LayoutEngineConfig;
  registry?: WidgetRegistryConfig;
  streamer?: DashboardStreamerConfig;
}

// ---------------------------------------------------------------------------
// DashboardGenerator
// ---------------------------------------------------------------------------

/**
 * Generates and manages live dashboards from arbitrary data maps.
 *
 * @example
 * const gen = new DashboardGenerator();
 * const layout = gen.generate("dash-1", [
 *   { key: "revenue",  data: [{ month: "Jan", value: 1200 }] },
 *   { key: "openRate", data: 0.42 },
 * ]);
 * // → DashboardLayout with a chart + a metric widget arranged in a 4-col grid
 */
export class DashboardGenerator {
  private readonly autoWidgets: AutoWidgets;
  private readonly layoutEngine: LayoutEngine;
  readonly registry: WidgetRegistry;
  readonly streamer: DashboardStreamer;

  /** Stored user preferences keyed by dashboard id. */
  private readonly preferences = new Map<string, DashboardPreferences>();

  constructor(config: DashboardGeneratorConfig = {}) {
    this.autoWidgets = new AutoWidgets(config.autoWidget ?? {});
    this.layoutEngine = new LayoutEngine(config.layout ?? {});
    this.registry = new WidgetRegistry(config.registry ?? {});
    this.streamer = new DashboardStreamer(config.streamer ?? {});
  }

  // ---------------------------------------------------------------------------
  // Generation
  // ---------------------------------------------------------------------------

  /**
   * Generate (or regenerate) a dashboard layout from a list of data entries.
   * If preferences have been saved for this dashboard id they are applied.
   * After generation the new layout is pushed to any active subscribers.
   */
  generate(
    dashboardId: string,
    entries: DataEntry[],
    contextOverride?: LayoutContext
  ): DashboardLayout {
    const prefs = this.preferences.get(dashboardId);
    const context: LayoutContext = contextOverride ?? prefs?.layoutContext ?? {};

    // Build widget specs via AutoWidgets
    const widgets = this.buildWidgets(entries, prefs);

    // Arrange into a grid
    const layout = this.layoutEngine.arrange(dashboardId, widgets, context, prefs?.title);

    // Notify subscribers
    this.streamer.pushLayout(dashboardId, layout);

    return layout;
  }

  /**
   * Add a single new data entry to an existing dashboard, then re-generate.
   */
  addEntry(dashboardId: string, currentEntries: DataEntry[], newEntry: DataEntry): DashboardLayout {
    return this.generate(dashboardId, [...currentEntries, newEntry]);
  }

  // ---------------------------------------------------------------------------
  // Preferences
  // ---------------------------------------------------------------------------

  /** Save user preferences for a dashboard. */
  savePreferences(prefs: DashboardPreferences): void {
    this.preferences.set(prefs.dashboardId, prefs);
  }

  /** Retrieve preferences for a dashboard. */
  getPreferences(dashboardId: string): DashboardPreferences | undefined {
    return this.preferences.get(dashboardId);
  }

  /** Clear preferences for a dashboard. */
  clearPreferences(dashboardId: string): boolean {
    return this.preferences.delete(dashboardId);
  }

  // ---------------------------------------------------------------------------
  // Export helpers
  // ---------------------------------------------------------------------------

  /**
   * Serialize a layout to a plain JSON-compatible object suitable for
   * caching, sharing, or sending over the wire.
   * (Layouts are already plain objects — this is a no-op type cast with a
   * validation-friendly wrapper.)
   */
  serialize(layout: DashboardLayout): Record<string, unknown> {
    return layout as unknown as Record<string, unknown>;
  }

  /**
   * Restore a layout from a serialized object.
   * Performs a shallow cast; callers should validate the object independently.
   */
  deserialize(raw: Record<string, unknown>): DashboardLayout {
    return raw as unknown as DashboardLayout;
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildWidgets(
    entries: DataEntry[],
    prefs: DashboardPreferences | undefined
  ): WidgetSpec[] {
    return entries.map(({ key, data, hints }) => {
      const widgetOverride = prefs?.widgetOverrides?.[key];
      const mergedHints: AutoWidgetHints = {
        ...hints,
        overrides: { ...hints?.overrides, ...widgetOverride },
      };
      const { spec } = this.autoWidgets.generate(key, key, data, mergedHints);
      return spec;
    });
  }
}
