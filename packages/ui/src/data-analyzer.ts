/**
 * Data shape analyzer — V2-18.
 * Inspects an arbitrary data value and infers the most appropriate widget
 * kind and configuration.  No ML — purely structural/statistical heuristics.
 */

import type {
  WidgetKind,
  ChartType,
  TableColumn,
  ChartAxis,
  FormField,
} from "./widget-templates.js";

// ---------------------------------------------------------------------------
// Analysis result
// ---------------------------------------------------------------------------

export interface AnalysisResult {
  /** Recommended widget kind. */
  recommendedKind: WidgetKind;
  /** For chart kinds, the recommended sub-type. */
  recommendedChartType?: ChartType;
  /** Inferred column definitions when the data looks like a table. */
  inferredColumns?: TableColumn[];
  /** Inferred x-axis when the data looks like a chart series. */
  inferredXAxis?: ChartAxis;
  /** Inferred y-axes when the data looks like a chart series. */
  inferredYAxes?: ChartAxis[];
  /** Inferred form fields when the data looks like a form schema. */
  inferredFields?: FormField[];
  /** Key in each record that holds the primary label or display text. */
  labelKey?: string;
  /** Key in each record that holds the timestamp value for timeline widgets. */
  timestampKey?: string;
  /** Key in each record that holds the primary numeric/KPI value. */
  valueKey?: string;
  /** Confidence score 0–1 for the recommendation. */
  confidence: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function isNumeric(v: unknown): boolean {
  return typeof v === "number" && isFinite(v);
}

function isDateLike(v: unknown): boolean {
  if (typeof v === "string") {
    return !isNaN(Date.parse(v));
  }
  return v instanceof Date;
}

function isStringLike(v: unknown): boolean {
  return typeof v === "string";
}

/**
 * Count how many values of each type appear in the array for a given key.
 */
function typeProfile(
  rows: Record<string, unknown>[],
  key: string
): { numeric: number; date: number; string: number; other: number } {
  const profile = { numeric: 0, date: 0, string: 0, other: 0 };
  for (const row of rows) {
    const v = row[key];
    if (isNumeric(v)) profile.numeric++;
    else if (isDateLike(v)) profile.date++;
    else if (isStringLike(v)) profile.string++;
    else profile.other++;
  }
  return profile;
}

/**
 * Derive a TableColumn from a key name and its type profile.
 */
function inferColumn(key: string, rows: Record<string, unknown>[]): TableColumn {
  const profile = typeProfile(rows, key);
  let format: string | undefined;
  if (profile.date > rows.length * 0.5) format = "date";
  else if (profile.numeric > rows.length * 0.5) format = "number";
  return { key, label: humanize(key), format, sortable: profile.numeric > 0 || profile.date > 0 };
}

/** Convert a camelCase / snake_case / kebab-case key to a human label. */
function humanize(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\w/, (c) => c.toUpperCase());
}

// ---------------------------------------------------------------------------
// DataAnalyzer
// ---------------------------------------------------------------------------

export interface DataAnalyzerConfig {
  /**
   * Minimum fraction of rows where a column is numeric before the analyzer
   * treats it as a numeric column for chart recommendation.
   * Default: 0.7
   */
  numericThreshold?: number;
  /**
   * Minimum number of rows required to recommend a chart over a table.
   * Default: 3
   */
  minRowsForChart?: number;
  /**
   * Maximum number of distinct categorical values before switching to a
   * bar/line chart instead of a pie chart.
   * Default: 8
   */
  maxPieCategories?: number;
}

/**
 * Analyzes an arbitrary data value and recommends the most appropriate
 * widget kind plus extracted configuration for that widget.
 *
 * Supported data shapes:
 *  - Array of uniform objects → table or chart
 *  - Single plain object with numeric value → metric / card
 *  - Single plain object with mostly string fields → form or card
 *  - Primitive (string / number) → metric / card
 */
export class DataAnalyzer {
  private readonly numericThreshold: number;
  private readonly minRowsForChart: number;
  private readonly maxPieCategories: number;

  constructor(config: DataAnalyzerConfig = {}) {
    this.numericThreshold = config.numericThreshold ?? 0.7;
    this.minRowsForChart = config.minRowsForChart ?? 3;
    this.maxPieCategories = config.maxPieCategories ?? 8;
  }

  /**
   * Analyze a data value and return a widget recommendation.
   */
  analyze(data: unknown): AnalysisResult {
    if (Array.isArray(data)) {
      return this.analyzeArray(data);
    }
    if (isPlainObject(data)) {
      return this.analyzeObject(data);
    }
    // Primitives
    return {
      recommendedKind: "metric",
      valueKey: "value",
      confidence: 0.6,
    };
  }

  // ---------------------------------------------------------------------------
  // Private — array analysis
  // ---------------------------------------------------------------------------

  private analyzeArray(data: unknown[]): AnalysisResult {
    if (data.length === 0) {
      return { recommendedKind: "list", confidence: 0.5 };
    }

    // Array of plain objects
    if (data.every(isPlainObject)) {
      return this.analyzeObjectArray(data as Record<string, unknown>[]);
    }

    // Array of primitives → simple list
    if (data.every((v) => isStringLike(v) || isNumeric(v))) {
      return { recommendedKind: "list", labelKey: "value", confidence: 0.7 };
    }

    return { recommendedKind: "list", confidence: 0.4 };
  }

  private analyzeObjectArray(rows: Record<string, unknown>[]): AnalysisResult {
    const keys = Array.from(new Set(rows.flatMap(Object.keys)));
    if (keys.length === 0) {
      return { recommendedKind: "list", confidence: 0.4 };
    }

    // Profile each key
    const profiles = Object.fromEntries(keys.map((k) => [k, typeProfile(rows, k)]));

    const numericKeys = keys.filter(
      (k) => profiles[k].numeric / rows.length >= this.numericThreshold
    );
    const dateKeys = keys.filter((k) => profiles[k].date / rows.length >= this.numericThreshold);
    const stringKeys = keys.filter(
      (k) => profiles[k].string / rows.length >= this.numericThreshold
    );

    // Timeline: has a date key and a label key
    if (dateKeys.length >= 1 && stringKeys.length >= 1) {
      const timestampKey = dateKeys[0];
      const labelKey = stringKeys[0];
      return {
        recommendedKind: "timeline",
        timestampKey,
        labelKey,
        confidence: 0.75,
        inferredColumns: keys.map((k) => inferColumn(k, rows)),
      };
    }

    // Chart: at least one x-axis (string/date) and one or more numeric y-axes
    if (rows.length >= this.minRowsForChart && numericKeys.length >= 1) {
      const xKey = stringKeys[0] ?? dateKeys[0] ?? keys[0];
      const yKeys = numericKeys.filter((k) => k !== xKey);

      if (yKeys.length >= 1) {
        const xAxis: ChartAxis = { key: xKey, label: humanize(xKey) };
        const yAxes: ChartAxis[] = yKeys.map((k) => ({ key: k, label: humanize(k) }));

        // Pick chart type
        const distinctX = new Set(rows.map((r) => String(r[xKey]))).size;
        let chartType: ChartType = "bar";
        if (dateKeys.includes(xKey)) chartType = "line";
        else if (distinctX <= this.maxPieCategories && yKeys.length === 1) chartType = "pie";

        return {
          recommendedKind: "chart",
          recommendedChartType: chartType,
          inferredXAxis: xAxis,
          inferredYAxes: yAxes,
          confidence: 0.8,
        };
      }
    }

    // Table: many columns or many rows
    if (keys.length >= 3 || rows.length >= 5) {
      return {
        recommendedKind: "table",
        inferredColumns: keys.map((k) => inferColumn(k, rows)),
        labelKey: stringKeys[0],
        confidence: 0.85,
      };
    }

    // Small list of objects
    return {
      recommendedKind: "list",
      labelKey: stringKeys[0] ?? keys[0],
      confidence: 0.6,
    };
  }

  // ---------------------------------------------------------------------------
  // Private — single object analysis
  // ---------------------------------------------------------------------------

  private analyzeObject(obj: Record<string, unknown>): AnalysisResult {
    const keys = Object.keys(obj);
    if (keys.length === 0) {
      return { recommendedKind: "card", confidence: 0.4 };
    }

    const numericKeys = keys.filter((k) => isNumeric(obj[k]));
    const stringKeys = keys.filter((k) => isStringLike(obj[k]));

    // Single numeric value → metric
    if (numericKeys.length === 1 && keys.length <= 3) {
      return {
        recommendedKind: "metric",
        valueKey: numericKeys[0],
        labelKey: stringKeys[0],
        confidence: 0.85,
      };
    }

    // Many string fields → form-like
    if (stringKeys.length >= 3 && numericKeys.length <= 1) {
      const fields: FormField[] = keys.map((k) => ({
        key: k,
        label: humanize(k),
        type: isNumeric(obj[k]) ? "number" : "text",
      }));
      return { recommendedKind: "form", inferredFields: fields, confidence: 0.65 };
    }

    // Generic object → card
    return {
      recommendedKind: "card",
      valueKey: numericKeys[0] ?? keys[0],
      labelKey: stringKeys[0],
      confidence: 0.6,
    };
  }
}
