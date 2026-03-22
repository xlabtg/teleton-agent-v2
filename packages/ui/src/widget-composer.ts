/**
 * Widget composer — V2-18.
 * Builds complex views by nesting and combining WidgetSpec objects into a
 * tree structure called a ComposedView.  Render adapters walk the tree and
 * produce the final component hierarchy.
 */

import type { WidgetSpec } from "./widget-templates.js";

// ---------------------------------------------------------------------------
// Composition types
// ---------------------------------------------------------------------------

/** Layout direction for a container node. */
export type LayoutDirection = "row" | "column" | "grid";

/**
 * A node in the composition tree is either a leaf (WidgetSpec) or a
 * container that holds child nodes.
 */
export type CompositionNode = WidgetLeaf | WidgetContainer;

/** A leaf node wrapping a single WidgetSpec. */
export interface WidgetLeaf {
  type: "widget";
  spec: WidgetSpec;
  /** Flex/grid grow factor. Default 1. */
  grow?: number;
  /** Minimum width hint (CSS value string, e.g. "300px"). */
  minWidth?: string;
}

/** A container node that arranges its children in a row, column, or grid. */
export interface WidgetContainer {
  type: "container";
  id: string;
  direction: LayoutDirection;
  children: CompositionNode[];
  /** Number of grid columns (only meaningful when direction = "grid"). */
  gridColumns?: number;
  /** Gap between children (CSS value string, e.g. "16px"). */
  gap?: string;
  /** Container title rendered as a section header. */
  title?: string;
  /** Flex/grid grow factor for the container itself. Default 1. */
  grow?: number;
}

/** The root of a composed view, ready for a render adapter to consume. */
export interface ComposedView {
  id: string;
  title?: string;
  root: CompositionNode;
  /** ISO-8601 timestamp of when this view was composed. */
  composedAt: string;
}

// ---------------------------------------------------------------------------
// Builder helpers
// ---------------------------------------------------------------------------

/** Wrap a WidgetSpec in a leaf node. */
export function leaf(spec: WidgetSpec, grow?: number, minWidth?: string): WidgetLeaf {
  return { type: "widget", spec, grow, minWidth };
}

/** Create a row container. */
export function row(
  id: string,
  children: CompositionNode[],
  options: { gap?: string; title?: string; grow?: number } = {}
): WidgetContainer {
  return { type: "container", id, direction: "row", children, ...options };
}

/** Create a column container. */
export function column(
  id: string,
  children: CompositionNode[],
  options: { gap?: string; title?: string; grow?: number } = {}
): WidgetContainer {
  return { type: "container", id, direction: "column", children, ...options };
}

/** Create a grid container. */
export function grid(
  id: string,
  children: CompositionNode[],
  gridColumns: number,
  options: { gap?: string; title?: string; grow?: number } = {}
): WidgetContainer {
  return { type: "container", id, direction: "grid", gridColumns, children, ...options };
}

// ---------------------------------------------------------------------------
// WidgetComposer
// ---------------------------------------------------------------------------

export interface WidgetComposerConfig {
  /** Default gap between widgets in a container. Default: "16px". */
  defaultGap?: string;
}

/**
 * Fluent builder for ComposedView objects.
 *
 * @example
 * const view = new WidgetComposer()
 *   .setTitle("Overview")
 *   .setRoot(
 *     row("main", [
 *       leaf(metricSpec),
 *       column("right", [leaf(chartSpec), leaf(tableSpec)]),
 *     ])
 *   )
 *   .build("dashboard-overview");
 */
export class WidgetComposer {
  private _title?: string;
  private _root?: CompositionNode;
  private readonly defaultGap: string;

  constructor(config: WidgetComposerConfig = {}) {
    this.defaultGap = config.defaultGap ?? "16px";
  }

  setTitle(title: string): this {
    this._title = title;
    return this;
  }

  setRoot(node: CompositionNode): this {
    this._root = node;
    return this;
  }

  /**
   * Build a flat view where all widgets are rendered in a grid.
   */
  grid(id: string, specs: WidgetSpec[], columns = 2): this {
    const children = specs.map((s) => leaf(s));
    this._root = grid(id, children, columns, { gap: this.defaultGap });
    return this;
  }

  /**
   * Compose the view and return the immutable result.
   * Throws if no root node has been set.
   */
  build(id: string): ComposedView {
    if (!this._root) {
      throw new Error(`WidgetComposer: cannot build view "${id}" — no root node set.`);
    }
    return {
      id,
      title: this._title,
      root: this._root,
      composedAt: new Date().toISOString(),
    };
  }

  // ---------------------------------------------------------------------------
  // Static utilities
  // ---------------------------------------------------------------------------

  /**
   * Collect all WidgetSpec objects from a composition tree (depth-first).
   */
  static extractSpecs(node: CompositionNode): WidgetSpec[] {
    if (node.type === "widget") return [node.spec];
    return node.children.flatMap((child) => WidgetComposer.extractSpecs(child));
  }

  /**
   * Find a widget leaf by spec id within a composition tree.
   */
  static findById(node: CompositionNode, id: string): WidgetLeaf | undefined {
    if (node.type === "widget") {
      return node.spec.id === id ? node : undefined;
    }
    for (const child of node.children) {
      const found = WidgetComposer.findById(child, id);
      if (found) return found;
    }
    return undefined;
  }
}
