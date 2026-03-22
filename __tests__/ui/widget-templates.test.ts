import { describe, it, expect } from "vitest";
import {
  tableTemplate,
  chartTemplate,
  listTemplate,
  cardTemplate,
  metricTemplate,
  formTemplate,
  timelineTemplate,
} from "../../packages/ui/src/widget-templates.js";
import type { FormField } from "../../packages/ui/src/widget-templates.js";

describe("widget-templates", () => {
  describe("tableTemplate", () => {
    it("creates a table spec with correct kind and columns", () => {
      const cols = [{ key: "name", label: "Name" }];
      const spec = tableTemplate("t1", "myData", cols);
      expect(spec.id).toBe("t1");
      expect(spec.kind).toBe("table");
      expect(spec.dataKey).toBe("myData");
      expect(spec.columns).toEqual(cols);
    });

    it("applies interaction defaults", () => {
      const spec = tableTemplate("t1", "d", []);
      expect(spec.interaction?.selectable).toBe(true);
      expect(spec.interaction?.filterable).toBe(true);
      expect(spec.interaction?.sortable).toBe(true);
    });

    it("allows overrides", () => {
      const spec = tableTemplate("t1", "d", [], { title: "My Table", pageSize: 10 });
      expect(spec.title).toBe("My Table");
      expect(spec.pageSize).toBe(10);
    });
  });

  describe("chartTemplate", () => {
    it("creates a chart spec with correct kind and chart type", () => {
      const spec = chartTemplate("c1", "data", "bar", { key: "x" }, [{ key: "y" }]);
      expect(spec.kind).toBe("chart");
      expect(spec.chartType).toBe("bar");
      expect(spec.xAxis).toEqual({ key: "x" });
      expect(spec.yAxes).toEqual([{ key: "y" }]);
    });
  });

  describe("listTemplate", () => {
    it("creates a list spec", () => {
      const spec = listTemplate("l1", "items", "title");
      expect(spec.kind).toBe("list");
      expect(spec.labelKey).toBe("title");
    });
  });

  describe("cardTemplate", () => {
    it("creates a card spec", () => {
      const spec = cardTemplate("card1", "user", "name");
      expect(spec.kind).toBe("card");
      expect(spec.valueKey).toBe("name");
    });
  });

  describe("metricTemplate", () => {
    it("creates a metric spec with unit", () => {
      const spec = metricTemplate("m1", "stats", "count", "requests/s");
      expect(spec.kind).toBe("metric");
      expect(spec.unit).toBe("requests/s");
      expect(spec.valueKey).toBe("count");
    });

    it("creates a metric spec without unit", () => {
      const spec = metricTemplate("m1", "stats", "count");
      expect(spec.unit).toBeUndefined();
    });
  });

  describe("formTemplate", () => {
    it("creates a form spec with fields", () => {
      const fields: FormField[] = [{ key: "email", label: "Email", type: "text", required: true }];
      const spec = formTemplate("f1", "formData", fields);
      expect(spec.kind).toBe("form");
      expect(spec.fields).toEqual(fields);
      expect(spec.interaction?.submittable).toBe(true);
    });
  });

  describe("timelineTemplate", () => {
    it("creates a timeline spec", () => {
      const spec = timelineTemplate("tl1", "events", "createdAt", "description");
      expect(spec.kind).toBe("timeline");
      expect(spec.timestampKey).toBe("createdAt");
      expect(spec.eventLabelKey).toBe("description");
    });
  });

  describe("BASE_DEFAULTS", () => {
    it("all templates include showSkeleton=true", () => {
      expect(tableTemplate("x", "d", []).showSkeleton).toBe(true);
      expect(chartTemplate("x", "d", "line", { key: "x" }, [{ key: "y" }]).showSkeleton).toBe(true);
    });

    it("all templates include pageSize=25 by default", () => {
      expect(metricTemplate("x", "d", "v").pageSize).toBe(25);
    });
  });
});
