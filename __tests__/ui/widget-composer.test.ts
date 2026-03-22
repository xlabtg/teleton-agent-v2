import { describe, it, expect } from "vitest";
import {
  WidgetComposer,
  leaf,
  row,
  column,
  grid,
} from "../../packages/ui/src/widget-composer.js";
import { metricTemplate, chartTemplate } from "../../packages/ui/src/widget-templates.js";

const metricSpec = metricTemplate("m1", "kpi", "value");
const chartSpec = chartTemplate("c1", "data", "bar", { key: "x" }, [{ key: "y" }]);

describe("WidgetComposer", () => {
  describe("leaf()", () => {
    it("creates a widget leaf node", () => {
      const node = leaf(metricSpec);
      expect(node.type).toBe("widget");
      expect(node.spec).toBe(metricSpec);
    });

    it("accepts grow and minWidth", () => {
      const node = leaf(metricSpec, 2, "200px");
      expect(node.grow).toBe(2);
      expect(node.minWidth).toBe("200px");
    });
  });

  describe("row() / column() / grid()", () => {
    it("creates a row container", () => {
      const node = row("r1", [leaf(metricSpec)]);
      expect(node.type).toBe("container");
      expect(node.direction).toBe("row");
    });

    it("creates a column container", () => {
      const node = column("col1", [leaf(chartSpec)]);
      expect(node.direction).toBe("column");
    });

    it("creates a grid container with column count", () => {
      const node = grid("g1", [leaf(metricSpec), leaf(chartSpec)], 3);
      expect(node.direction).toBe("grid");
      expect(node.gridColumns).toBe(3);
    });
  });

  describe("WidgetComposer builder", () => {
    it("builds a view with a root node", () => {
      const view = new WidgetComposer()
        .setTitle("My Dashboard")
        .setRoot(row("main", [leaf(metricSpec), leaf(chartSpec)]))
        .build("dash-1");

      expect(view.id).toBe("dash-1");
      expect(view.title).toBe("My Dashboard");
      expect(view.root.type).toBe("container");
      expect(view.composedAt).toBeDefined();
    });

    it("throws when build() called without root", () => {
      const composer = new WidgetComposer();
      expect(() => composer.build("dash-1")).toThrow();
    });

    it("grid() helper sets a flat grid root", () => {
      const view = new WidgetComposer().grid("g1", [metricSpec, chartSpec], 2).build("dash-1");
      expect(view.root.type).toBe("container");
    });
  });

  describe("WidgetComposer.extractSpecs()", () => {
    it("extracts all leaf specs from a nested tree", () => {
      const root = row("r", [
        leaf(metricSpec),
        column("c", [leaf(chartSpec)]),
      ]);
      const specs = WidgetComposer.extractSpecs(root);
      expect(specs).toHaveLength(2);
      expect(specs.map((s) => s.id)).toContain("m1");
      expect(specs.map((s) => s.id)).toContain("c1");
    });
  });

  describe("WidgetComposer.findById()", () => {
    it("finds a widget leaf by id", () => {
      const root = row("r", [leaf(metricSpec), leaf(chartSpec)]);
      const found = WidgetComposer.findById(root, "c1");
      expect(found?.spec.id).toBe("c1");
    });

    it("returns undefined for unknown id", () => {
      const root = leaf(metricSpec);
      expect(WidgetComposer.findById(root, "unknown")).toBeUndefined();
    });
  });
});
