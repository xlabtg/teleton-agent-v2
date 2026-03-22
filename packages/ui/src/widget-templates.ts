/**
 * Widget template library — V2-18.
 * Defines the specification format and built-in templates for common data
 * presentations: table, chart, list, card, and form.
 * Templates are framework-agnostic; render adapters (React, Vue, etc.) consume
 * the spec and produce actual DOM/component trees.
 */

// ---------------------------------------------------------------------------
// Widget specification types
// ---------------------------------------------------------------------------

/** The visual / interaction category of a widget. */
export type WidgetKind = "table" | "chart" | "list" | "card" | "form" | "metric" | "timeline";

/** Chart sub-types used by the "chart" kind. */
export type ChartType = "bar" | "line" | "pie" | "scatter" | "area";

/** Alignment options for cell / label text. */
export type TextAlign = "left" | "center" | "right";

/** Column definition for table widgets. */
export interface TableColumn {
  key: string;
  label: string;
  align?: TextAlign;
  /** Format hint for render adapters, e.g. "date", "currency", "percent". */
  format?: string;
  sortable?: boolean;
}

/** Axis configuration for chart widgets. */
export interface ChartAxis {
  key: string;
  label?: string;
  format?: string;
}

/** A single form field definition. */
export interface FormField {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "checkbox" | "date" | "textarea";
  placeholder?: string;
  required?: boolean;
  options?: Array<{ value: string; label: string }>;
}

/** Interaction configuration — which events the widget emits. */
export interface InteractionConfig {
  /** Row/item click emits a "select" event with the item as payload. */
  selectable?: boolean;
  /** Table rows / list items can be filtered via a search input. */
  filterable?: boolean;
  /** Table columns can be sorted by the user. */
  sortable?: boolean;
  /** Form widgets emit a "submit" event with form data as payload. */
  submittable?: boolean;
}

/**
 * Complete framework-agnostic specification for a single widget.
 * Render adapters convert this into concrete component trees.
 */
export interface WidgetSpec {
  /** Unique identifier within a dashboard or composition. */
  id: string;
  kind: WidgetKind;
  title?: string;
  description?: string;

  // --- Data binding ---------------------------------------------------------
  /** Key path or alias used to look up the widget's data in the dashboard data map. */
  dataKey: string;

  // --- Kind-specific configuration ------------------------------------------
  /** Table: column definitions. */
  columns?: TableColumn[];
  /** Chart: x-axis definition. */
  xAxis?: ChartAxis;
  /** Chart: one or more y-axis series. */
  yAxes?: ChartAxis[];
  /** Chart: which sub-type to render. */
  chartType?: ChartType;
  /** Card / metric: the primary value key within the data object. */
  valueKey?: string;
  /** Card / metric: an optional secondary label key. */
  labelKey?: string;
  /** Metric: the unit suffix to display next to the value. */
  unit?: string;
  /** Form: field definitions. */
  fields?: FormField[];
  /** Timeline: event timestamp key. */
  timestampKey?: string;
  /** Timeline: label key for each event. */
  eventLabelKey?: string;

  // --- Appearance -----------------------------------------------------------
  /** CSS color hint (hex, named colour, or CSS variable). */
  color?: string;
  /** Whether to show a loading skeleton while data is fetched. */
  showSkeleton?: boolean;
  /** Maximum number of items / rows to display before pagination. */
  pageSize?: number;

  // --- Interaction ----------------------------------------------------------
  interaction?: InteractionConfig;
}

// ---------------------------------------------------------------------------
// Template builders
// ---------------------------------------------------------------------------

/**
 * Minimal defaults applied to every widget spec so render adapters can
 * assume these fields are always present.
 */
const BASE_DEFAULTS: Pick<WidgetSpec, "showSkeleton" | "pageSize"> = {
  showSkeleton: true,
  pageSize: 25,
};

/** Build a table widget spec with sensible defaults. */
export function tableTemplate(
  id: string,
  dataKey: string,
  columns: TableColumn[],
  overrides: Partial<WidgetSpec> = {}
): WidgetSpec {
  return {
    ...BASE_DEFAULTS,
    id,
    kind: "table",
    dataKey,
    columns,
    interaction: { selectable: true, filterable: true, sortable: true },
    ...overrides,
  };
}

/** Build a chart widget spec with sensible defaults. */
export function chartTemplate(
  id: string,
  dataKey: string,
  chartType: ChartType,
  xAxis: ChartAxis,
  yAxes: ChartAxis[],
  overrides: Partial<WidgetSpec> = {}
): WidgetSpec {
  return {
    ...BASE_DEFAULTS,
    id,
    kind: "chart",
    dataKey,
    chartType,
    xAxis,
    yAxes,
    interaction: { selectable: false },
    ...overrides,
  };
}

/** Build a list widget spec. */
export function listTemplate(
  id: string,
  dataKey: string,
  labelKey: string,
  overrides: Partial<WidgetSpec> = {}
): WidgetSpec {
  return {
    ...BASE_DEFAULTS,
    id,
    kind: "list",
    dataKey,
    labelKey,
    interaction: { selectable: true, filterable: true },
    ...overrides,
  };
}

/** Build a card widget spec (single data object). */
export function cardTemplate(
  id: string,
  dataKey: string,
  valueKey: string,
  overrides: Partial<WidgetSpec> = {}
): WidgetSpec {
  return {
    ...BASE_DEFAULTS,
    id,
    kind: "card",
    dataKey,
    valueKey,
    interaction: { selectable: false },
    ...overrides,
  };
}

/** Build a metric (KPI) widget spec. */
export function metricTemplate(
  id: string,
  dataKey: string,
  valueKey: string,
  unit?: string,
  overrides: Partial<WidgetSpec> = {}
): WidgetSpec {
  return {
    ...BASE_DEFAULTS,
    id,
    kind: "metric",
    dataKey,
    valueKey,
    unit,
    interaction: { selectable: false },
    ...overrides,
  };
}

/** Build a form widget spec. */
export function formTemplate(
  id: string,
  dataKey: string,
  fields: FormField[],
  overrides: Partial<WidgetSpec> = {}
): WidgetSpec {
  return {
    ...BASE_DEFAULTS,
    id,
    kind: "form",
    dataKey,
    fields,
    interaction: { submittable: true },
    ...overrides,
  };
}

/** Build a timeline widget spec. */
export function timelineTemplate(
  id: string,
  dataKey: string,
  timestampKey: string,
  eventLabelKey: string,
  overrides: Partial<WidgetSpec> = {}
): WidgetSpec {
  return {
    ...BASE_DEFAULTS,
    id,
    kind: "timeline",
    dataKey,
    timestampKey,
    eventLabelKey,
    interaction: { selectable: true },
    ...overrides,
  };
}
