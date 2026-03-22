/**
 * Widget registry — V2-17.
 * Central catalogue of available widget types.  Each entry declares the
 * widget's typed data requirements so the dashboard generator can match
 * incoming data shapes to appropriate renderers.
 */

import type { WidgetKind } from "./widget-templates.js";

// ---------------------------------------------------------------------------
// Registry types
// ---------------------------------------------------------------------------

/**
 * Describes the data shape a widget type requires.
 * These are runtime hints used by the layout engine and auto-widget system;
 * they are not enforced at the TypeScript type level (too dynamic for that).
 */
export interface WidgetDataRequirement {
  /** Whether the widget expects an array of objects. */
  expectsArray: boolean;
  /** Minimum number of items needed to render meaningfully. Default 0. */
  minItems?: number;
  /** Keys expected to be present in each data record. */
  requiredKeys?: string[];
  /** At least one of these keys must be present (optional alternative keys). */
  oneOfKeys?: string[];
}

/** A full entry in the widget registry. */
export interface WidgetRegistryEntry {
  kind: WidgetKind;
  displayName: string;
  description: string;
  dataRequirement: WidgetDataRequirement;
  /** Priority for auto-selection when multiple widgets are viable (higher wins). */
  priority: number;
  /**
   * Render adapter tags: which frameworks have a concrete implementation.
   * For example ["react", "vue"].  The list is informational — the registry
   * itself is adapter-agnostic.
   */
  adapterTags?: string[];
}

// ---------------------------------------------------------------------------
// Built-in entries
// ---------------------------------------------------------------------------

const BUILT_IN_ENTRIES: WidgetRegistryEntry[] = [
  {
    kind: "metric",
    displayName: "Metric",
    description: "Displays a single numeric KPI with an optional label and unit.",
    dataRequirement: { expectsArray: false, requiredKeys: [] },
    priority: 10,
    adapterTags: ["react", "vue"],
  },
  {
    kind: "card",
    displayName: "Card",
    description: "Displays a compact summary card for a single data object.",
    dataRequirement: { expectsArray: false, requiredKeys: [] },
    priority: 8,
    adapterTags: ["react", "vue"],
  },
  {
    kind: "list",
    displayName: "List",
    description: "Renders an ordered or unordered list of items.",
    dataRequirement: { expectsArray: true, minItems: 1 },
    priority: 6,
    adapterTags: ["react", "vue"],
  },
  {
    kind: "table",
    displayName: "Table",
    description: "Renders a sortable, filterable data table.",
    dataRequirement: { expectsArray: true, minItems: 1 },
    priority: 7,
    adapterTags: ["react", "vue"],
  },
  {
    kind: "chart",
    displayName: "Chart",
    description: "Renders bar, line, pie, scatter, or area charts.",
    dataRequirement: { expectsArray: true, minItems: 2 },
    priority: 9,
    adapterTags: ["react"],
  },
  {
    kind: "form",
    displayName: "Form",
    description: "Renders an interactive input form derived from field definitions.",
    dataRequirement: { expectsArray: false, requiredKeys: [] },
    priority: 5,
    adapterTags: ["react", "vue"],
  },
  {
    kind: "timeline",
    displayName: "Timeline",
    description: "Renders a chronological timeline of events.",
    dataRequirement: { expectsArray: true, minItems: 1, requiredKeys: ["timestamp"] },
    priority: 7,
    adapterTags: ["react"],
  },
];

// ---------------------------------------------------------------------------
// WidgetRegistry
// ---------------------------------------------------------------------------

export interface WidgetRegistryConfig {
  /**
   * Whether to include the built-in widget entries on construction.
   * Default: true.
   */
  includeBuiltIns?: boolean;
}

/**
 * Central catalogue of available widget types.
 *
 * @example
 * const registry = new WidgetRegistry();
 * const entry = registry.get("chart"); // → WidgetRegistryEntry
 * const viable = registry.findViable({ expectsArray: true, minItems: 5 });
 */
export class WidgetRegistry {
  private readonly entries = new Map<WidgetKind, WidgetRegistryEntry>();

  constructor(config: WidgetRegistryConfig = {}) {
    if (config.includeBuiltIns !== false) {
      for (const entry of BUILT_IN_ENTRIES) {
        this.entries.set(entry.kind, entry);
      }
    }
  }

  /** Register or replace a widget entry. */
  register(entry: WidgetRegistryEntry): void {
    this.entries.set(entry.kind, entry);
  }

  /** Retrieve an entry by kind. Returns undefined if not registered. */
  get(kind: WidgetKind): WidgetRegistryEntry | undefined {
    return this.entries.get(kind);
  }

  /** Check whether a kind is registered. */
  has(kind: WidgetKind): boolean {
    return this.entries.has(kind);
  }

  /** Return all registered entries sorted by descending priority. */
  list(): WidgetRegistryEntry[] {
    return Array.from(this.entries.values()).sort((a, b) => b.priority - a.priority);
  }

  /**
   * Find all widget entries that satisfy a given data requirement.
   * Returns results sorted by descending priority.
   */
  findViable(requirement: Partial<WidgetDataRequirement>): WidgetRegistryEntry[] {
    return this.list().filter((entry) => {
      const req = entry.dataRequirement;
      if (requirement.expectsArray !== undefined && req.expectsArray !== requirement.expectsArray) {
        return false;
      }
      if (
        requirement.minItems !== undefined &&
        req.minItems !== undefined &&
        requirement.minItems < req.minItems
      ) {
        return false;
      }
      return true;
    });
  }

  /** Total number of registered widget types. */
  get size(): number {
    return this.entries.size;
  }
}
