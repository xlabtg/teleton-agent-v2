import { describe, it, expect } from "vitest";
import { AutoWidgets } from "../../packages/ui/src/auto-widgets.js";

describe("AutoWidgets", () => {
  const aw = new AutoWidgets();

  describe("generate()", () => {
    it("returns a widget spec and analysis result", () => {
      const result = aw.generate("w1", "myData", 42);
      expect(result.spec).toBeDefined();
      expect(result.analysis).toBeDefined();
      expect(result.spec.id).toBe("w1");
      expect(result.spec.dataKey).toBe("myData");
    });

    it("infers a metric spec for a primitive number", () => {
      const { spec } = aw.generate("m1", "kpi", 1234);
      expect(spec.kind).toBe("metric");
    });

    it("infers a chart spec for a numeric array", () => {
      const data = [
        { month: "Jan", value: 100 },
        { month: "Feb", value: 200 },
        { month: "Mar", value: 150 },
      ];
      const { spec } = aw.generate("chart1", "revenue", data);
      expect(spec.kind).toBe("chart");
    });

    it("infers a table spec for a wide array (no date columns)", () => {
      // Avoid date-parsable strings to prevent timeline recommendation
      const data = [
        { username: "alice", role: "admin", status: "active", score: 95, level: 5 },
        { username: "bob", role: "user", status: "inactive", score: 70, level: 3 },
      ];
      const { spec } = aw.generate("tbl", "users", data);
      expect(spec.kind).toBe("table");
    });

    it("applies kind hint to override inference", () => {
      const { spec } = aw.generate("c1", "data", 42, { kind: "card" });
      expect(spec.kind).toBe("card");
    });

    it("applies title hint", () => {
      const { spec } = aw.generate("m1", "data", 42, { title: "My Metric" });
      expect(spec.title).toBe("My Metric");
    });

    it("applies chartType hint", () => {
      const data = [
        { x: "A", y: 1 },
        { x: "B", y: 2 },
        { x: "C", y: 3 },
      ];
      const { spec } = aw.generate("c1", "data", data, { kind: "chart", chartType: "pie" });
      expect(spec.chartType).toBe("pie");
    });

    it("merges spec overrides", () => {
      const { spec } = aw.generate("m1", "data", 42, {
        overrides: { color: "#ff0000", pageSize: 10 },
      });
      expect(spec.color).toBe("#ff0000");
      expect(spec.pageSize).toBe(10);
    });
  });

  describe("generateBatch()", () => {
    it("generates multiple widgets", () => {
      const results = aw.generateBatch([
        { id: "w1", dataKey: "d1", data: 42 },
        { id: "w2", dataKey: "d2", data: [{ x: 1, y: 2 }, { x: 3, y: 4 }] },
      ]);
      expect(results).toHaveLength(2);
      expect(results[0].spec.id).toBe("w1");
      expect(results[1].spec.id).toBe("w2");
    });

    it("returns empty array for empty input", () => {
      expect(aw.generateBatch([])).toEqual([]);
    });
  });
});
