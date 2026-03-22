import { describe, it, expect } from "vitest";
import { UrgencyDetector } from "../../packages/intelligence/src/urgency-detector.js";

const REF = new Date("2024-06-15T12:00:00Z");

function detector() {
  return new UrgencyDetector({ referenceDate: REF });
}

describe("UrgencyDetector", () => {
  it("should detect 'asap' as critical", () => {
    const signals = detector().detect("Please fix this asap");
    expect(signals.some((s) => s.level === "critical")).toBe(true);
  });

  it("should detect 'urgent' as high", () => {
    const signals = detector().detect("This is urgent");
    expect(signals.some((s) => s.level === "high")).toBe(true);
  });

  it("should detect 'today' as high", () => {
    const signals = detector().detect("Finish the report today");
    expect(signals.some((s) => s.level === "high")).toBe(true);
  });

  it("should detect 'tomorrow' as normal", () => {
    const signals = detector().detect("Send the invoice tomorrow");
    const normal = signals.find((s) => s.trigger === "tomorrow");
    expect(normal?.level).toBe("normal");
  });

  it("should assign deadline-based urgency from time expressions", () => {
    // "in 30 minutes" → well within critical threshold (1h)
    const signals = detector().detect("Deadline: submit by in 30 minutes");
    const withDeadline = signals.find((s) => s.deadline !== undefined);
    expect(withDeadline).toBeDefined();
    expect(withDeadline!.level).toBe("critical");
  });

  it("should assign overdue as critical when deadline has passed", () => {
    const det = new UrgencyDetector({ referenceDate: REF });
    // timeRemainingMs < 0 → critical
    expect(det.levelFromTimeRemaining(-1000)).toBe("critical");
  });

  it("should return low level for distant future deadline", () => {
    const det = new UrgencyDetector({ referenceDate: REF });
    expect(det.levelFromTimeRemaining(7 * 86_400_000)).toBe("low");
  });

  it("highestLevel() returns critical when mixed signals", () => {
    const signals = detector().detect("This is urgent and also asap");
    expect(detector().highestLevel(signals)).toBe("critical");
  });

  it("highestLevel() returns low for empty array", () => {
    expect(detector().highestLevel([])).toBe("low");
  });

  it("should return empty array for neutral text", () => {
    const signals = detector().detect("Let me know how you are doing");
    expect(signals).toHaveLength(0);
  });
});
