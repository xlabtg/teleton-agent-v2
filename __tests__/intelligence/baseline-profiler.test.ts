import { describe, expect, it } from "vitest";

import { BaselineProfiler } from "../../packages/intelligence/src/baseline-profiler.js";

describe("BaselineProfiler", () => {
  it("uses sample standard deviation for finite observation windows", () => {
    const profiler = new BaselineProfiler();

    profiler.recordBatch("latency", [2, 4, 4]);

    const baseline = profiler.getBaseline("latency");

    expect(baseline).not.toBeNull();
    expect(baseline?.mean).toBeCloseTo(10 / 3);
    expect(baseline?.stdDev).toBeCloseTo(Math.sqrt(4 / 3));
    expect(baseline?.sampleCount).toBe(3);
  });
});
