import { describe, it, expect } from "vitest";
import { ScheduleParser } from "../../packages/intelligence/src/schedule-parser.js";

const REF = new Date("2024-06-15T08:00:00Z"); // Saturday

function parser() {
  return new ScheduleParser({ referenceDate: REF });
}

describe("ScheduleParser", () => {
  it("should return null for non-scheduling text", () => {
    expect(parser().parse("What is the weather today?")).toBeNull();
  });

  it("should parse 'remind me tomorrow at 9am to call Alice'", () => {
    const result = parser().parse("remind me tomorrow at 9am to call Alice");
    expect(result).not.toBeNull();
    expect(result!.action).toContain("call Alice");
    expect(result!.triggerAt.toISOString().startsWith("2024-06-16")).toBe(true);
    expect(result!.triggerAt.getUTCHours()).toBe(9);
    expect(result!.recurrence.kind).toBe("once");
    expect(result!.confidence).toBeGreaterThan(0.5);
  });

  it("should parse 'remind me in 2 hours to check the build'", () => {
    const result = parser().parse("remind me in 2 hours to check the build");
    expect(result).not.toBeNull();
    expect(result!.triggerAt.getTime()).toBeCloseTo(REF.getTime() + 2 * 3_600_000, -3);
    expect(result!.action).toContain("check the build");
  });

  it("should detect 'every day' recurrence", () => {
    const result = parser().parse("remind me every day at 8am to take my pills");
    expect(result).not.toBeNull();
    expect(result!.recurrence.kind).toBe("daily");
    if (result!.recurrence.kind === "daily") {
      expect(result!.recurrence.intervalDays).toBe(1);
    }
  });

  it("should detect 'every week' recurrence", () => {
    const result = parser().parse("schedule a weekly review every week on Monday");
    expect(result).not.toBeNull();
    expect(result!.recurrence.kind).toBe("weekly");
  });

  it("should detect 'every 3 days' recurrence", () => {
    const result = parser().parse("remind me every 3 days to water the plants");
    expect(result).not.toBeNull();
    if (result!.recurrence.kind === "daily") {
      expect(result!.recurrence.intervalDays).toBe(3);
    }
  });

  it("should parse 'set a reminder for tomorrow'", () => {
    const result = parser().parse("set a reminder for tomorrow");
    expect(result).not.toBeNull();
    expect(result!.triggerAt.toISOString().startsWith("2024-06-16")).toBe(true);
  });

  it("should have lower confidence when no intent keyword", () => {
    // Has a time expression but no explicit intent keyword
    const withIntent = parser().parse("remind me tomorrow");
    const withoutIntent = parser().parse("tomorrow meeting");
    if (withoutIntent) {
      expect(withoutIntent.confidence).toBeLessThan(withIntent?.confidence ?? 1);
    }
  });

  it("should expose raw text", () => {
    const text = "remind me tomorrow to review the PR";
    const result = parser().parse(text);
    expect(result!.raw).toBe(text);
  });
});
