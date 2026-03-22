/**
 * Layout engine — V2-17.
 * Selects and arranges widgets into a dashboard grid based on available data
 * and context signals.  Produces a DashboardLayout that can be rendered by
 * any adapter (React, Vue, server-side HTML, etc.).
 *
 * The engine is intentionally decoupled from any specific UI framework.
 */

import type { WidgetSpec, WidgetKind } from "./widget-templates.js";

// ---------------------------------------------------------------------------
// Layout types
// ---------------------------------------------------------------------------

/** How many grid columns a widget occupies. */
export type ColSpan = 1 | 2 | 3 | 4;

/** How many grid rows a widget occupies. */
export type RowSpan = 1 | 2 | 3;

/** A positioned widget slot in the layout grid. */
export interface LayoutSlot {
  widget: WidgetSpec;
  /** 1-based grid column start. */
  col: number;
  /** 1-based grid row start. */
  row: number;
  colSpan: ColSpan;
  rowSpan: RowSpan;
}

/** The full layout produced by the layout engine. */
export interface DashboardLayout {
  id: string;
  title?: string;
  /** Total number of grid columns in this layout. */
  totalColumns: number;
  slots: LayoutSlot[];
  /** ISO-8601 timestamp of when the layout was generated. */
  generatedAt: string;
}

// ---------------------------------------------------------------------------
// Context and preferences
// ---------------------------------------------------------------------------

/** Signals about the current rendering context. */
export interface LayoutContext {
  /** Viewport width in pixels — used to choose number of columns. */
  viewportWidth?: number;
  /** User's preferred layout density. Default "comfortable". */
  density?: "compact" | "comfortable" | "spacious";
  /** Explicit total column count override. */
  columns?: number;
}

/** Per-kind size hints used when auto-placing widgets. */
const KIND_SIZE: Record<WidgetKind, { colSpan: ColSpan; rowSpan: RowSpan }> = {
  metric: { colSpan: 1, rowSpan: 1 },
  card: { colSpan: 1, rowSpan: 1 },
  list: { colSpan: 1, rowSpan: 2 },
  form: { colSpan: 2, rowSpan: 2 },
  chart: { colSpan: 2, rowSpan: 2 },
  table: { colSpan: 4, rowSpan: 2 },
  timeline: { colSpan: 3, rowSpan: 2 },
};

// ---------------------------------------------------------------------------
// LayoutEngine
// ---------------------------------------------------------------------------

export interface LayoutEngineConfig {
  /** Default total column count when no context signal is available. Default: 4. */
  defaultColumns?: number;
  /**
   * Breakpoint widths (px) → column counts.
   * Defaults: { 480: 1, 768: 2, 1280: 4 }
   */
  breakpoints?: Record<number, number>;
}

/**
 * Arranges a list of WidgetSpec objects into a responsive grid layout.
 *
 * The engine uses a "next-fit shelf" algorithm:
 *  1. Widgets are sorted by importance (metric/card first, table/chart last).
 *  2. Each widget is placed in the first grid position that can accommodate
 *     its colSpan without overflowing the total column count.
 *  3. If a widget is too wide for the remaining columns, it is placed on a
 *     new row.
 */
export class LayoutEngine {
  private readonly defaultColumns: number;
  private readonly breakpoints: Array<{ width: number; cols: number }>;

  constructor(config: LayoutEngineConfig = {}) {
    this.defaultColumns = config.defaultColumns ?? 4;
    const bp = config.breakpoints ?? { 480: 1, 768: 2, 1280: 4 };
    this.breakpoints = Object.entries(bp)
      .map(([w, c]) => ({ width: Number(w), cols: c }))
      .sort((a, b) => a.width - b.width);
  }

  /**
   * Generate a dashboard layout from an ordered list of widgets.
   */
  arrange(
    id: string,
    widgets: WidgetSpec[],
    context: LayoutContext = {},
    title?: string
  ): DashboardLayout {
    const totalColumns = this.resolveColumns(context);
    const sorted = this.sortByImportance(widgets);
    const slots = this.placeWidgets(sorted, totalColumns);

    return {
      id,
      title,
      totalColumns,
      slots,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Re-arrange an existing layout, preserving as many user placements as
   * possible while inserting new widgets.
   */
  rearrange(
    existing: DashboardLayout,
    newWidgets: WidgetSpec[],
    context: LayoutContext = {}
  ): DashboardLayout {
    const existingSpecs = existing.slots.map((s) => s.widget);
    const combined = [...existingSpecs, ...newWidgets];
    return this.arrange(existing.id, combined, context, existing.title);
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private resolveColumns(context: LayoutContext): number {
    if (context.columns) return context.columns;

    const width = context.viewportWidth;
    if (width !== undefined) {
      // Find the largest breakpoint that is <= viewport width
      let cols = 1;
      for (const bp of this.breakpoints) {
        if (width >= bp.width) cols = bp.cols;
      }
      // Apply density adjustment
      if (context.density === "compact" && cols > 1) cols = Math.max(1, cols - 1);
      if (context.density === "spacious" && cols < 6) cols = Math.min(6, cols + 1);
      return cols;
    }

    return this.defaultColumns;
  }

  /**
   * Sort widgets so small KPI/metric widgets appear first (top-left), and
   * large table/chart widgets appear later.
   */
  private sortByImportance(widgets: WidgetSpec[]): WidgetSpec[] {
    const order: WidgetKind[] = ["metric", "card", "list", "form", "chart", "timeline", "table"];
    return [...widgets].sort(
      (a, b) => order.indexOf(a.kind) - order.indexOf(b.kind)
    );
  }

  /**
   * Next-fit shelf placement: iterate widgets and assign each to the first
   * available position in the grid.
   */
  private placeWidgets(widgets: WidgetSpec[], totalColumns: number): LayoutSlot[] {
    const slots: LayoutSlot[] = [];
    // occupancy[row][col] = true when that cell is taken
    const occupied: boolean[][] = [];

    const isFree = (startRow: number, startCol: number, cs: number, rs: number): boolean => {
      for (let r = startRow; r < startRow + rs; r++) {
        for (let c = startCol; c < startCol + cs; c++) {
          if (occupied[r]?.[c]) return false;
        }
      }
      return true;
    };

    const mark = (startRow: number, startCol: number, cs: number, rs: number): void => {
      for (let r = startRow; r < startRow + rs; r++) {
        if (!occupied[r]) occupied[r] = [];
        for (let c = startCol; c < startCol + cs; c++) {
          occupied[r][c] = true;
        }
      }
    };

    for (const widget of widgets) {
      const size = KIND_SIZE[widget.kind];
      // Clamp colSpan to totalColumns
      const cs = Math.min(size.colSpan, totalColumns) as ColSpan;
      const rs = size.rowSpan;

      // Scan for the first free position (row by row, column by column)
      let placed = false;
      for (let row = 1; !placed; row++) {
        for (let col = 1; col <= totalColumns - cs + 1; col++) {
          if (isFree(row, col, cs, rs)) {
            slots.push({ widget, col, row, colSpan: cs, rowSpan: rs });
            mark(row, col, cs, rs);
            placed = true;
            break;
          }
        }
      }
    }

    return slots;
  }
}
