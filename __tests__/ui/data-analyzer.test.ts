import { describe, it, expect } from "vitest";
import { DataAnalyzer } from "../../packages/ui/src/data-analyzer.js";

describe("DataAnalyzer", () => {
  const analyzer = new DataAnalyzer();

  describe("primitives", () => {
    it("recommends metric for a number", () => {
      const result = analyzer.analyze(42);
      expect(result.recommendedKind).toBe("metric");
    });

    it("recommends metric for a string", () => {
      const result = analyzer.analyze("hello");
      expect(result.recommendedKind).toBe("metric");
    });
  });

  describe("empty array", () => {
    it("recommends list for empty array", () => {
      const result = analyzer.analyze([]);
      expect(result.recommendedKind).toBe("list");
    });
  });

  describe("array of objects", () => {
    it("recommends chart when array has string + numeric columns", () => {
      const data = [
        { month: "Jan", revenue: 100 },
        { month: "Feb", revenue: 200 },
        { month: "Mar", revenue: 150 },
      ];
      const result = analyzer.analyze(data);
      expect(result.recommendedKind).toBe("chart");
      expect(result.inferredXAxis?.key).toBe("month");
      expect(result.inferredYAxes?.[0].key).toBe("revenue");
    });

    it("recommends pie chart for few categorical x-axis values", () => {
      // 3 distinct categories < maxPieCategories (8) with one numeric key → pie
      const data = [
        { category: "A", count: 10 },
        { category: "B", count: 20 },
        { category: "C", count: 5 },
      ];
      const result = analyzer.analyze(data);
      expect(result.recommendedChartType).toBe("pie");
    });

    it("recommends bar chart for many categorical x-axis values", () => {
      // >8 distinct categories → bar
      const data = Array.from({ length: 10 }, (_, i) => ({
        category: `Cat${i}`,
        count: i * 10,
      }));
      const result = analyzer.analyze(data);
      expect(result.recommendedChartType).toBe("bar");
    });

    it("recommends line chart when x-axis is date-like", () => {
      const data = [
        { date: "2024-01-01", value: 10 },
        { date: "2024-01-02", value: 20 },
        { date: "2024-01-03", value: 15 },
      ];
      const result = analyzer.analyze(data);
      expect(result.recommendedChartType).toBe("line");
    });

    it("recommends table for wide arrays (many keys, no date column)", () => {
      // Use only string/number columns; avoid date-parsable strings (e.g. ISO dates, "user-1")
      const data = [
        { username: "alice", role: "admin", status: "active", score: 95, level: 5 },
        { username: "bob", role: "user", status: "inactive", score: 70, level: 3 },
      ];
      const result = analyzer.analyze(data);
      expect(result.recommendedKind).toBe("table");
      expect(result.inferredColumns?.length).toBeGreaterThan(0);
    });

    it("infers sortable columns for numeric fields", () => {
      const data = [
        { name: "A", score: 10 },
        { name: "B", score: 20 },
        { name: "C", score: 30 },
        { name: "D", score: 40 },
        { name: "E", score: 50 },
      ];
      const result = analyzer.analyze(data);
      if (result.inferredColumns) {
        const scoreCol = result.inferredColumns.find((c) => c.key === "score");
        expect(scoreCol?.sortable).toBe(true);
      }
    });

    it("recommends timeline when array has date and string columns", () => {
      const data = [
        { timestamp: "2024-01-01T00:00:00Z", event: "login" },
        { timestamp: "2024-01-02T00:00:00Z", event: "logout" },
        { timestamp: "2024-01-03T00:00:00Z", event: "login" },
      ];
      const result = analyzer.analyze(data);
      expect(result.recommendedKind).toBe("timeline");
    });
  });

  describe("single object", () => {
    it("recommends metric for a single numeric key object", () => {
      const result = analyzer.analyze({ value: 42 });
      expect(result.recommendedKind).toBe("metric");
      expect(result.valueKey).toBe("value");
    });

    it("recommends form for a string-heavy object", () => {
      const result = analyzer.analyze({
        firstName: "John",
        lastName: "Doe",
        email: "john@example.com",
        phone: "555-1234",
      });
      expect(result.recommendedKind).toBe("form");
      expect(result.inferredFields?.length).toBeGreaterThan(0);
    });

    it("recommends card for a multi-numeric object", () => {
      // Two numeric keys — not a single-value metric → card
      const result = analyzer.analyze({ a: 1, b: 2 });
      expect(result.recommendedKind).toBe("card");
    });
  });

  describe("empty object", () => {
    it("recommends card for an empty object", () => {
      const result = analyzer.analyze({});
      expect(result.recommendedKind).toBe("card");
    });
  });

  describe("confidence scores", () => {
    it("returns a confidence in [0,1]", () => {
      const result = analyzer.analyze([{ x: 1 }]);
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.confidence).toBeLessThanOrEqual(1);
    });
  });
});
