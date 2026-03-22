import { describe, it, expect, beforeEach } from "vitest";
import { PatternMiner } from "../../packages/intelligence/src/pattern-miner.js";
import type { BehavioralEvent } from "../../packages/intelligence/src/behavior-tracker.js";

function makeEvent(action: BehavioralEvent["action"], offset = 0): BehavioralEvent {
  return {
    id: crypto.randomUUID(),
    userId: "u1",
    action,
    context: {},
    timestamp: new Date(Date.now() + offset),
  };
}

describe("PatternMiner", () => {
  let miner: PatternMiner;

  beforeEach(() => {
    miner = new PatternMiner({ minSupport: 2, windowSize: 50, maxSequenceLength: 3 });
  });

  it("should return empty array for fewer than 2 events", () => {
    const events = [makeEvent("message_sent")];
    expect(miner.mine(events)).toEqual([]);
  });

  it("should detect a recurring 2-action sequence", () => {
    const events: BehavioralEvent[] = [
      makeEvent("message_sent"),
      makeEvent("query_submitted"),
      makeEvent("message_sent"),
      makeEvent("query_submitted"),
    ];
    const patterns = miner.mine(events);
    const found = patterns.find(
      (p) => p.sequence[0] === "message_sent" && p.sequence[1] === "query_submitted"
    );
    expect(found).toBeDefined();
    expect(found!.support).toBeGreaterThanOrEqual(2);
  });

  it("should not return patterns below minSupport", () => {
    // A sequence that appears only once
    const events: BehavioralEvent[] = [
      makeEvent("session_started"),
      makeEvent("tool_used"),
      makeEvent("message_sent"),
      makeEvent("query_submitted"),
    ];
    const miner1 = new PatternMiner({ minSupport: 3 });
    const patterns = miner1.mine(events);
    expect(patterns).toHaveLength(0);
  });

  it("should filter patterns by prefix", () => {
    const events: BehavioralEvent[] = [
      makeEvent("message_sent"),
      makeEvent("query_submitted"),
      makeEvent("message_sent"),
      makeEvent("query_submitted"),
      makeEvent("tool_used"),
      makeEvent("query_submitted"),
      makeEvent("tool_used"),
      makeEvent("query_submitted"),
    ];
    const patterns = miner.mine(events);
    const filtered = miner.filterByPrefix(patterns, "message_sent");
    for (const p of filtered) {
      expect(p.sequence[0]).toBe("message_sent");
    }
  });

  it("should sort patterns by support descending", () => {
    const events: BehavioralEvent[] = [];
    // message_sent → query_submitted appears 3 times
    for (let i = 0; i < 3; i++) {
      events.push(makeEvent("message_sent"), makeEvent("query_submitted"));
    }
    // tool_used → response_accepted appears 2 times
    for (let i = 0; i < 2; i++) {
      events.push(makeEvent("tool_used"), makeEvent("response_accepted"));
    }

    const patterns = miner.mine(events);
    for (let i = 1; i < patterns.length; i++) {
      expect(patterns[i - 1].support).toBeGreaterThanOrEqual(patterns[i].support);
    }
  });
});
