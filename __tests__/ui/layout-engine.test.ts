import { describe, it, expect } from "vitest";
import { LayoutEngine } from "../../packages/ui/src/layout-engine.js";
import {
  metricTemplate,
  chartTemplate,
  tableTemplate,
  listTemplate,
} from "../../packages/ui/src/widget-templates.js";

const metric1 = metricTemplate("m1", "kpi1", "value");
const metric2 = metricTemplate("m2", "kpi2", "value");
const chart1 = chartTemplate("c1", "data", "bar", { key: "x" }, [{ key: "y" }]);
const table1 = tableTemplate("t1", "rows", [{ key: "id", label: "ID" }]);
const list1 = listTemplate("l1", "items", "name");

describe("LayoutEngine", () => {
  const engine = new LayoutEngine({ defaultColumns: 4 });

  describe("arrange()", () => {
    it("returns a DashboardLayout with the correct id", () => {
      const layout = engine.arrange("dash-1", [metric1]);
      expect(layout.id).toBe("dash-1");
      expect(layout.totalColumns).toBe(4);
      expect(layout.generatedAt).toBeDefined();
    });

    it("places all widgets as slots", () => {
      const layout = engine.arrange("dash-1", [metric1, metric2, chart1]);
      expect(layout.slots.length).toBe(3);
    });

    it("assigns valid grid positions (col and row >= 1)", () => {
      const layout = engine.arrange("dash-1", [metric1, metric2, chart1, table1]);
      for (const slot of layout.slots) {
        expect(slot.col).toBeGreaterThanOrEqual(1);
        expect(slot.row).toBeGreaterThanOrEqual(1);
        expect(slot.colSpan).toBeGreaterThanOrEqual(1);
        expect(slot.rowSpan).toBeGreaterThanOrEqual(1);
      }
    });

    it("clamps colSpan to totalColumns", () => {
      const narrowEngine = new LayoutEngine({ defaultColumns: 1 });
      const layout = narrowEngine.arrange("dash-1", [table1]); // table normally wants 4 cols
      expect(layout.slots[0].colSpan).toBe(1);
    });

    it("uses viewport width to choose column count", () => {
      const layout = engine.arrange("dash-1", [metric1], { viewportWidth: 500 });
      // 500px → matches 480px breakpoint → 1 column
      expect(layout.totalColumns).toBe(1);
    });

    it("handles empty widget list", () => {
      const layout = engine.arrange("dash-1", []);
      expect(layout.slots).toHaveLength(0);
    });

    it("sets title when provided", () => {
      const layout = engine.arrange("dash-1", [], {}, "My Dashboard");
      expect(layout.title).toBe("My Dashboard");
    });
  });

  describe("rearrange()", () => {
    it("combines existing and new widgets", () => {
      const existing = engine.arrange("dash-1", [metric1, chart1]);
      const updated = engine.rearrange(existing, [list1]);
      expect(updated.slots.length).toBe(3);
    });

    it("preserves the dashboard id", () => {
      const existing = engine.arrange("dash-42", [metric1]);
      const updated = engine.rearrange(existing, [metric2]);
      expect(updated.id).toBe("dash-42");
    });
  });

  describe("sort order", () => {
    it("places metric/card widgets before tables", () => {
      const layout = engine.arrange("dash-1", [table1, metric1]);
      const metricSlot = layout.slots.find((s) => s.widget.id === "m1")!;
      const tableSlot = layout.slots.find((s) => s.widget.id === "t1")!;
      // metric should come before table in row order
      expect(metricSlot.row).toBeLessThanOrEqual(tableSlot.row);
    });
  });
});
