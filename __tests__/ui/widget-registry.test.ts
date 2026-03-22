import { describe, it, expect } from "vitest";
import { WidgetRegistry } from "../../packages/ui/src/widget-registry.js";
import type { WidgetRegistryEntry } from "../../packages/ui/src/widget-registry.js";

describe("WidgetRegistry", () => {
  describe("built-in entries", () => {
    it("includes all 7 built-in kinds by default", () => {
      const registry = new WidgetRegistry();
      expect(registry.size).toBe(7);
    });

    it("has entries for all expected kinds", () => {
      const registry = new WidgetRegistry();
      for (const kind of [
        "metric",
        "card",
        "list",
        "table",
        "chart",
        "form",
        "timeline",
      ] as const) {
        expect(registry.has(kind)).toBe(true);
      }
    });

    it("can be created without built-ins", () => {
      const registry = new WidgetRegistry({ includeBuiltIns: false });
      expect(registry.size).toBe(0);
    });
  });

  describe("register()", () => {
    it("adds a new custom entry", () => {
      const registry = new WidgetRegistry({ includeBuiltIns: false });
      const entry: WidgetRegistryEntry = {
        kind: "metric",
        displayName: "My Metric",
        description: "Custom metric",
        dataRequirement: { expectsArray: false },
        priority: 5,
      };
      registry.register(entry);
      expect(registry.size).toBe(1);
      expect(registry.get("metric")?.displayName).toBe("My Metric");
    });

    it("replaces an existing entry", () => {
      const registry = new WidgetRegistry();
      const original = registry.get("chart");
      registry.register({ ...original!, displayName: "My Chart" });
      expect(registry.get("chart")?.displayName).toBe("My Chart");
      expect(registry.size).toBe(7); // no increase
    });
  });

  describe("get()", () => {
    it("returns undefined for unregistered kind", () => {
      const registry = new WidgetRegistry({ includeBuiltIns: false });
      expect(registry.get("chart")).toBeUndefined();
    });
  });

  describe("list()", () => {
    it("returns entries sorted by descending priority", () => {
      const registry = new WidgetRegistry();
      const list = registry.list();
      for (let i = 1; i < list.length; i++) {
        expect(list[i - 1].priority).toBeGreaterThanOrEqual(list[i].priority);
      }
    });
  });

  describe("findViable()", () => {
    it("finds array-based widgets", () => {
      const registry = new WidgetRegistry();
      const results = registry.findViable({ expectsArray: true });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.dataRequirement.expectsArray).toBe(true);
      }
    });

    it("finds non-array widgets", () => {
      const registry = new WidgetRegistry();
      const results = registry.findViable({ expectsArray: false });
      expect(results.length).toBeGreaterThan(0);
      for (const r of results) {
        expect(r.dataRequirement.expectsArray).toBe(false);
      }
    });

    it("excludes widgets that require more items than available", () => {
      const registry = new WidgetRegistry();
      // chart requires minItems: 2; querying with minItems: 1 should exclude chart
      const results = registry.findViable({ expectsArray: true, minItems: 1 });
      const chart = results.find((r) => r.kind === "chart");
      expect(chart).toBeUndefined();
    });
  });
});
