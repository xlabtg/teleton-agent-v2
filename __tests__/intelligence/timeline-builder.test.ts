import { describe, it, expect, beforeEach } from "vitest";
import { TimelineBuilder } from "../../packages/intelligence/src/timeline-builder.js";

const T = (iso: string) => new Date(iso);

describe("TimelineBuilder", () => {
  let builder: TimelineBuilder;

  beforeEach(() => {
    builder = new TimelineBuilder();
  });

  it("should add events and maintain chronological order", () => {
    builder.addEvent({ description: "C", timestamp: T("2024-01-03T00:00:00Z"), source: "conversation" });
    builder.addEvent({ description: "A", timestamp: T("2024-01-01T00:00:00Z"), source: "conversation" });
    builder.addEvent({ description: "B", timestamp: T("2024-01-02T00:00:00Z"), source: "conversation" });

    const all = builder.all();
    expect(all.map((e) => e.description)).toEqual(["A", "B", "C"]);
  });

  it("should replace an existing event with the same id", () => {
    const ev = builder.addEvent({
      id: "evt-1",
      description: "Original",
      timestamp: T("2024-01-01T00:00:00Z"),
      source: "memory",
    });
    builder.addEvent({
      id: "evt-1",
      description: "Updated",
      timestamp: T("2024-01-01T00:00:00Z"),
      source: "memory",
    });
    expect(builder.size).toBe(1);
    expect(builder.all()[0].description).toBe("Updated");
  });

  it("should remove an event by id", () => {
    const ev = builder.addEvent({
      description: "Remove me",
      timestamp: T("2024-01-01T00:00:00Z"),
      source: "conversation",
    });
    builder.removeEvent(ev.id);
    expect(builder.size).toBe(0);
  });

  it("should filter by source in query", () => {
    builder.addEvent({ description: "m1", timestamp: T("2024-01-01T00:00:00Z"), source: "memory" });
    builder.addEvent({ description: "c1", timestamp: T("2024-01-02T00:00:00Z"), source: "conversation" });
    const { events } = builder.query({ source: "memory" });
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe("m1");
  });

  it("should filter by tags (all required)", () => {
    builder.addEvent({
      description: "tagged",
      timestamp: T("2024-01-01T00:00:00Z"),
      source: "system",
      tags: ["deadline", "meeting"],
    });
    builder.addEvent({
      description: "partial",
      timestamp: T("2024-01-02T00:00:00Z"),
      source: "system",
      tags: ["meeting"],
    });
    const { events } = builder.query({ tags: ["deadline", "meeting"] });
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe("tagged");
  });

  it("should filter by since/until", () => {
    builder.addEvent({ description: "early", timestamp: T("2024-01-01T00:00:00Z"), source: "conversation" });
    builder.addEvent({ description: "middle", timestamp: T("2024-01-05T00:00:00Z"), source: "conversation" });
    builder.addEvent({ description: "late", timestamp: T("2024-01-10T00:00:00Z"), source: "conversation" });

    const { events } = builder.query({
      since: T("2024-01-03T00:00:00Z"),
      until: T("2024-01-07T00:00:00Z"),
    });
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe("middle");
  });

  it("should paginate with offset/limit", () => {
    for (let i = 0; i < 5; i++) {
      builder.addEvent({
        description: `e${i}`,
        timestamp: new Date(Date.UTC(2024, 0, i + 1)),
        source: "system",
      });
    }
    const { events, total } = builder.query({ offset: 2, limit: 2 });
    expect(total).toBe(5);
    expect(events).toHaveLength(2);
    expect(events[0].description).toBe("e2");
  });

  it("should detect gaps exceeding the threshold", () => {
    const gapDetector = new TimelineBuilder({ gapThresholdMs: 2 * 3_600_000 }); // 2h
    gapDetector.addEvent({ description: "A", timestamp: T("2024-01-01T00:00:00Z"), source: "s" });
    gapDetector.addEvent({ description: "B", timestamp: T("2024-01-01T05:00:00Z"), source: "s" }); // 5h gap
    gapDetector.addEvent({ description: "C", timestamp: T("2024-01-01T06:00:00Z"), source: "s" }); // 1h gap (no gap)

    const gaps = gapDetector.detectGaps();
    expect(gaps).toHaveLength(1);
    expect(gaps[0].durationMs).toBe(5 * 3_600_000);
  });

  it("should trim oldest events when maxEvents is exceeded", () => {
    const small = new TimelineBuilder({ maxEvents: 3 });
    for (let i = 0; i < 5; i++) {
      small.addEvent({
        description: `e${i}`,
        timestamp: new Date(Date.UTC(2024, 0, i + 1)),
        source: "s",
      });
    }
    expect(small.size).toBe(3);
    // Oldest (e0, e1) should be gone; e2, e3, e4 remain
    const descriptions = small.all().map((e) => e.description);
    expect(descriptions).not.toContain("e0");
    expect(descriptions).not.toContain("e1");
  });

  it("window() should return events within rolling duration", () => {
    const now = T("2024-01-10T12:00:00Z");
    builder.addEvent({ description: "recent", timestamp: T("2024-01-10T11:00:00Z"), source: "s" });
    builder.addEvent({ description: "old", timestamp: T("2024-01-01T00:00:00Z"), source: "s" });
    const events = builder.window(2 * 3_600_000, now); // last 2h
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe("recent");
  });
});
