// V2-18: Auto-Generated UI Widgets
export {
  tableTemplate,
  chartTemplate,
  listTemplate,
  cardTemplate,
  metricTemplate,
  formTemplate,
  timelineTemplate,
} from "./widget-templates.js";
export type {
  WidgetKind,
  ChartType,
  TextAlign,
  TableColumn,
  ChartAxis,
  FormField,
  InteractionConfig,
  WidgetSpec,
} from "./widget-templates.js";

export { DataAnalyzer } from "./data-analyzer.js";
export type { AnalysisResult, DataAnalyzerConfig } from "./data-analyzer.js";

export { AutoWidgets } from "./auto-widgets.js";
export type { AutoWidgetHints, GeneratedWidget, AutoWidgetConfig } from "./auto-widgets.js";

export { WidgetComposer, leaf, row, column, grid } from "./widget-composer.js";
export type {
  LayoutDirection,
  CompositionNode,
  WidgetLeaf,
  WidgetContainer,
  ComposedView,
  WidgetComposerConfig,
} from "./widget-composer.js";

// V2-17: Dynamic Dashboard Generation
export { LayoutEngine } from "./layout-engine.js";
export type {
  ColSpan,
  RowSpan,
  LayoutSlot,
  DashboardLayout,
  LayoutContext,
  LayoutEngineConfig,
} from "./layout-engine.js";

export { WidgetRegistry } from "./widget-registry.js";
export type {
  WidgetDataRequirement,
  WidgetRegistryEntry,
  WidgetRegistryConfig,
} from "./widget-registry.js";

export { DashboardStreamer } from "./dashboard-streamer.js";
export type {
  PatchKind,
  DashboardPatch,
  PatchHandler,
  StreamSubscription,
  DashboardStreamerConfig,
} from "./dashboard-streamer.js";

export { DashboardGenerator } from "./dashboard-generator.js";
export type {
  DataEntry,
  DashboardPreferences,
  DashboardGeneratorConfig,
} from "./dashboard-generator.js";
