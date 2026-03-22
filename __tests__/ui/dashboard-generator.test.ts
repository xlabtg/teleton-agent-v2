import { describe, it, expect, afterEach } from "vitest";
import { DashboardGenerator } from "../../packages/ui/src/dashboard-generator.js";
import type { DataEntry, DashboardPreferences } from "../../packages/ui/src/dashboard-generator.js";

function makeEntries(): DataEntry[] {
  return [
    { key: "revenue", data: [{ month: "Jan", value: 100 }, { month: "Feb", value: 200 }, { month: "Mar", value: 150 }] },
    { key: "users", data: 1042 },
    {
      key: "orders",
      data: [
        { id: "1", name: "Alice", total: 200, status: "shipped", date: "2024-01-01" },
        { id: "2", name: "Bob", total: 150, status: "pending", date: "2024-01-02" },
      ],
    },
  ];
}

describe("DashboardGenerator", () => {
  let gen: DashboardGenerator;

  afterEach(() => {
    gen.streamer.destroy();
  });

  describe("generate()", () => {
    it("returns a DashboardLayout", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      const layout = gen.generate("dash-1", makeEntries());
      expect(layout.id).toBe("dash-1");
      expect(layout.slots.length).toBe(3);
    });

    it("creates one slot per data entry", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      const entries = makeEntries();
      const layout = gen.generate("dash-1", entries);
      expect(layout.slots.length).toBe(entries.length);
    });

    it("pushes layout to streamer subscribers", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      const patches: string[] = [];
      gen.streamer.subscribe("dash-1", (p) => patches.push(p.kind));
      gen.generate("dash-1", makeEntries());
      expect(patches).toContain("layout_replaced");
    });

    it("accepts a layout context override", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      const layout = gen.generate("dash-1", makeEntries(), { columns: 2 });
      expect(layout.totalColumns).toBe(2);
    });
  });

  describe("addEntry()", () => {
    it("adds a widget and re-generates", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      const initial = makeEntries();
      const layout = gen.addEntry("dash-1", initial, { key: "extra", data: 99 });
      expect(layout.slots.length).toBe(initial.length + 1);
    });
  });

  describe("preferences", () => {
    it("saves and retrieves preferences", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      const prefs: DashboardPreferences = {
        dashboardId: "dash-1",
        title: "My Custom Dashboard",
      };
      gen.savePreferences(prefs);
      expect(gen.getPreferences("dash-1")).toEqual(prefs);
    });

    it("applies title preference during generate", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      gen.savePreferences({ dashboardId: "dash-1", title: "Preferred Title" });
      const layout = gen.generate("dash-1", makeEntries());
      expect(layout.title).toBe("Preferred Title");
    });

    it("clears preferences", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      gen.savePreferences({ dashboardId: "dash-1", title: "Tmp" });
      const removed = gen.clearPreferences("dash-1");
      expect(removed).toBe(true);
      expect(gen.getPreferences("dash-1")).toBeUndefined();
    });

    it("clearPreferences returns false for unknown id", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      expect(gen.clearPreferences("nonexistent")).toBe(false);
    });
  });

  describe("serialize / deserialize", () => {
    it("round-trips a layout through serialize/deserialize", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      const layout = gen.generate("dash-1", makeEntries());
      const raw = gen.serialize(layout);
      const restored = gen.deserialize(raw);
      expect(restored.id).toBe("dash-1");
      expect(restored.slots.length).toBe(layout.slots.length);
    });
  });

  describe("registry", () => {
    it("exposes the widget registry", () => {
      gen = new DashboardGenerator({ streamer: { heartbeatIntervalMs: 0 } });
      expect(gen.registry.size).toBe(7);
    });
  });
});
