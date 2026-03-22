/**
 * Auto-widget generator — V2-18.
 * Given an arbitrary data value and optional hints, automatically selects
 * a widget template and configures it.  Uses DataAnalyzer for type inference
 * and the template builders from widget-templates.
 */

import { DataAnalyzer, type DataAnalyzerConfig, type AnalysisResult } from "./data-analyzer.js";
import {
  type WidgetSpec,
  type WidgetKind,
  type ChartType,
  tableTemplate,
  chartTemplate,
  listTemplate,
  cardTemplate,
  metricTemplate,
  formTemplate,
  timelineTemplate,
} from "./widget-templates.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface AutoWidgetHints {
  /** Override the inferred widget kind. */
  kind?: WidgetKind;
  /** Override the inferred chart type (only relevant when kind = "chart"). */
  chartType?: ChartType;
  /** Preferred title for the generated widget. */
  title?: string;
  /** Extra overrides merged into the final WidgetSpec. */
  overrides?: Partial<WidgetSpec>;
}

export interface GeneratedWidget {
  spec: WidgetSpec;
  analysis: AnalysisResult;
}

export interface AutoWidgetConfig extends DataAnalyzerConfig {
  /** Default page size for generated widgets. */
  defaultPageSize?: number;
}

// ---------------------------------------------------------------------------
// AutoWidgets
// ---------------------------------------------------------------------------

/**
 * Automatically generates WidgetSpec objects from arbitrary data.
 *
 * @example
 * const aw = new AutoWidgets();
 * const { spec } = aw.generate("widget-1", "myData", [
 *   { month: "Jan", revenue: 1200 },
 *   { month: "Feb", revenue: 1500 },
 * ]);
 * // → chartTemplate with kind="chart", chartType="bar", xAxis={key:"month"}, yAxes=[{key:"revenue"}]
 */
export class AutoWidgets {
  private readonly analyzer: DataAnalyzer;
  private readonly defaultPageSize: number;

  constructor(config: AutoWidgetConfig = {}) {
    this.analyzer = new DataAnalyzer(config);
    this.defaultPageSize = config.defaultPageSize ?? 25;
  }

  /**
   * Analyze `data` and produce a fully-configured WidgetSpec.
   *
   * @param id      Unique identifier for the generated widget.
   * @param dataKey The data-binding key the widget will use at render time.
   * @param data    The actual data value to analyze (used for type inference only).
   * @param hints   Optional overrides for the generated spec.
   */
  generate(
    id: string,
    dataKey: string,
    data: unknown,
    hints: AutoWidgetHints = {}
  ): GeneratedWidget {
    const analysis = this.analyzer.analyze(data);
    const kind = hints.kind ?? analysis.recommendedKind;
    const overrides: Partial<WidgetSpec> = {
      title: hints.title,
      pageSize: this.defaultPageSize,
      ...hints.overrides,
    };

    const spec = this.buildSpec(id, dataKey, kind, analysis, hints.chartType, overrides);
    return { spec, analysis };
  }

  /**
   * Batch-generate widget specs for multiple data entries.
   * Each entry maps a logical name to its data value.
   */
  generateBatch(
    entries: Array<{ id: string; dataKey: string; data: unknown; hints?: AutoWidgetHints }>
  ): GeneratedWidget[] {
    return entries.map(({ id, dataKey, data, hints }) =>
      this.generate(id, dataKey, data, hints ?? {})
    );
  }

  // ---------------------------------------------------------------------------
  // Private
  // ---------------------------------------------------------------------------

  private buildSpec(
    id: string,
    dataKey: string,
    kind: WidgetKind,
    analysis: AnalysisResult,
    chartTypeHint: ChartType | undefined,
    overrides: Partial<WidgetSpec>
  ): WidgetSpec {
    switch (kind) {
      case "table": {
        const columns = analysis.inferredColumns ?? [];
        return tableTemplate(id, dataKey, columns, overrides);
      }

      case "chart": {
        const chartType = chartTypeHint ?? analysis.recommendedChartType ?? "bar";
        const xAxis = analysis.inferredXAxis ?? { key: "x", label: "X" };
        const yAxes = analysis.inferredYAxes ?? [{ key: "y", label: "Y" }];
        return chartTemplate(id, dataKey, chartType, xAxis, yAxes, overrides);
      }

      case "list": {
        const labelKey = analysis.labelKey ?? "label";
        return listTemplate(id, dataKey, labelKey, overrides);
      }

      case "card": {
        const valueKey = analysis.valueKey ?? "value";
        return cardTemplate(id, dataKey, valueKey, overrides);
      }

      case "metric": {
        const valueKey = analysis.valueKey ?? "value";
        const unit = (overrides as { unit?: string }).unit;
        return metricTemplate(id, dataKey, valueKey, unit, overrides);
      }

      case "form": {
        const fields = analysis.inferredFields ?? [];
        return formTemplate(id, dataKey, fields, overrides);
      }

      case "timeline": {
        const timestampKey = "timestamp";
        const eventLabelKey = analysis.labelKey ?? "label";
        return timelineTemplate(id, dataKey, timestampKey, eventLabelKey, overrides);
      }
    }
  }
}
