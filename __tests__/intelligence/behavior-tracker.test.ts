import { describe, it, expect, beforeEach } from "vitest";
import { BehaviorTracker } from "../../packages/intelligence/src/behavior-tracker.js";

describe("BehaviorTracker", () => {
  let tracker: BehaviorTracker;

  beforeEach(() => {
    tracker = new BehaviorTracker({ maxEventsPerUser: 5 });
  });

  it("should record events for a user", () => {
    tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: new Date() });
    expect(tracker.getEventCount("u1")).toBe(1);
  });

  it("should evict oldest events when limit exceeded", () => {
    for (let i = 0; i < 7; i++) {
      tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: new Date() });
    }
    expect(tracker.getEventCount("u1")).toBe(5);
  });

  it("should not record events for opted-out users", () => {
    tracker.optOut("u1");
    tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: new Date() });
    expect(tracker.getEventCount("u1")).toBe(0);
    expect(tracker.isOptedOut("u1")).toBe(true);
  });

  it("should delete existing events on opt-out", () => {
    tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: new Date() });
    tracker.optOut("u1");
    expect(tracker.getEventCount("u1")).toBe(0);
  });

  it("should allow opt-in after opt-out", () => {
    tracker.optOut("u1");
    tracker.optIn("u1");
    tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: new Date() });
    expect(tracker.getEventCount("u1")).toBe(1);
    expect(tracker.isOptedOut("u1")).toBe(false);
  });

  it("should reset user events without opting out", () => {
    tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: new Date() });
    tracker.reset("u1");
    expect(tracker.getEventCount("u1")).toBe(0);
    // Should still be able to record after reset
    tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: new Date() });
    expect(tracker.getEventCount("u1")).toBe(1);
  });

  it("should filter events by time window", () => {
    const past = new Date(Date.now() - 10000);
    const now = new Date();

    tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: past });
    tracker.record({ userId: "u1", action: "command_invoked", context: {}, timestamp: now });

    const window = tracker.getEventsInWindow("u1", new Date(Date.now() - 5000));
    expect(window).toHaveLength(1);
    expect(window[0].action).toBe("command_invoked");
  });

  it("should not record when globally disabled", () => {
    tracker.setEnabled(false);
    tracker.record({ userId: "u1", action: "message_sent", context: {}, timestamp: new Date() });
    expect(tracker.getEventCount("u1")).toBe(0);
    expect(tracker.isEnabled()).toBe(false);
  });
});
