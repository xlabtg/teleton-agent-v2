import { describe, it, expect, vi, afterEach } from "vitest";
import { DashboardStreamer } from "../../packages/ui/src/dashboard-streamer.js";
import { metricTemplate } from "../../packages/ui/src/widget-templates.js";
import type { DashboardLayout } from "../../packages/ui/src/layout-engine.js";

function makeLayout(id = "dash-1"): DashboardLayout {
  return {
    id,
    totalColumns: 4,
    slots: [],
    generatedAt: new Date().toISOString(),
  };
}

describe("DashboardStreamer", () => {
  let streamer: DashboardStreamer;

  afterEach(() => {
    streamer.destroy();
  });

  describe("subscribe / unsubscribe", () => {
    it("delivers patches to subscribers", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      const received: string[] = [];
      streamer.subscribe("dash-1", (patch) => received.push(patch.kind));
      streamer.pushLayout("dash-1", makeLayout());
      expect(received).toEqual(["layout_replaced"]);
    });

    it("does not deliver to unsubscribed handlers", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      const handler = vi.fn();
      const sub = streamer.subscribe("dash-1", handler);
      streamer.unsubscribe(sub.token);
      streamer.pushLayout("dash-1", makeLayout());
      expect(handler).not.toHaveBeenCalled();
    });

    it("unsubscribe returns false for unknown token", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      expect(streamer.unsubscribe("ghost-token")).toBe(false);
    });

    it("tracks subscriptionCount", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      const s1 = streamer.subscribe("d1", () => {});
      streamer.subscribe("d2", () => {});
      expect(streamer.subscriptionCount).toBe(2);
      streamer.unsubscribe(s1.token);
      expect(streamer.subscriptionCount).toBe(1);
    });
  });

  describe("push methods", () => {
    it("pushWidgetAdded delivers widget_added patch", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      const patches: string[] = [];
      streamer.subscribe("d1", (p) => patches.push(p.kind));
      streamer.pushWidgetAdded("d1", metricTemplate("m1", "kpi", "value"));
      expect(patches).toContain("widget_added");
    });

    it("pushWidgetRemoved delivers widget_removed patch", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      const patches: string[] = [];
      streamer.subscribe("d1", (p) => patches.push(p.kind));
      streamer.pushWidgetRemoved("d1", metricTemplate("m1", "kpi", "value"));
      expect(patches).toContain("widget_removed");
    });

    it("pushDataUpdate delivers data_updated patch with data", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      const patches: Array<{ kind: string; data: unknown }> = [];
      streamer.subscribe("d1", (p) => patches.push({ kind: p.kind, data: p.data }));
      streamer.pushDataUpdate("d1", metricTemplate("m1", "kpi", "value"), { count: 42 });
      expect(patches[0].kind).toBe("data_updated");
      expect(patches[0].data).toEqual({ count: 42 });
    });
  });

  describe("buffer", () => {
    it("buffers patches for catch-up", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0, bufferSize: 10 });
      streamer.pushLayout("d1", makeLayout("d1"));
      streamer.pushLayout("d1", makeLayout("d1"));
      const buf = streamer.getBuffer("d1");
      expect(buf.length).toBe(2);
    });

    it("respects bufferSize ring buffer", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0, bufferSize: 2 });
      for (let i = 0; i < 5; i++) {
        streamer.pushLayout("d1", makeLayout("d1"));
      }
      expect(streamer.getBuffer("d1").length).toBe(2);
    });

    it("limit parameter works on getBuffer", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0, bufferSize: 10 });
      for (let i = 0; i < 5; i++) streamer.pushLayout("d1", makeLayout("d1"));
      expect(streamer.getBuffer("d1", 2).length).toBe(2);
    });

    it("returns empty array for unknown dashboard", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      expect(streamer.getBuffer("unknown")).toEqual([]);
    });
  });

  describe("handler errors", () => {
    it("does not propagate handler errors to other subscribers", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      streamer.subscribe("d1", () => {
        throw new Error("bad handler");
      });
      const received: string[] = [];
      streamer.subscribe("d1", (p) => received.push(p.kind));
      // Should not throw
      expect(() => streamer.pushLayout("d1", makeLayout())).not.toThrow();
      expect(received).toContain("layout_replaced");
    });
  });

  describe("destroy()", () => {
    it("clears all subscriptions", () => {
      streamer = new DashboardStreamer({ heartbeatIntervalMs: 0 });
      streamer.subscribe("d1", () => {});
      streamer.destroy();
      expect(streamer.subscriptionCount).toBe(0);
    });
  });
});
