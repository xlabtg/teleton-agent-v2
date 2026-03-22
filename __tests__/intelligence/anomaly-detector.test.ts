import { describe, it, expect, vi, beforeEach } from "vitest";
import { BaselineProfiler } from "../../packages/intelligence/src/baseline-profiler.js";
import { AlertRouter } from "../../packages/intelligence/src/alert-router.js";
import { InvestigationContextBuilder } from "../../packages/intelligence/src/investigation-context.js";
import { AnomalyDetector } from "../../packages/intelligence/src/anomaly-detector.js";

describe("BaselineProfiler", () => {
  let profiler: BaselineProfiler;

  beforeEach(() => {
    profiler = new BaselineProfiler({ windowSize: 100 });
  });

  it("should return null with fewer than 2 observations", () => {
    profiler.record("latency", 100);
    expect(profiler.getBaseline("latency")).toBeNull();
  });

  it("should compute accurate mean and stdDev", () => {
    [10, 20, 30].forEach((v) => profiler.record("latency", v));
    const baseline = profiler.getBaseline("latency");
    expect(baseline).not.toBeNull();
    expect(baseline!.mean).toBeCloseTo(20);
    expect(baseline!.stdDev).toBeGreaterThan(0);
    expect(baseline!.sampleCount).toBe(3);
  });

  it("should compute correct quartiles for uniform data", () => {
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].forEach((v) => profiler.record("m", v));
    const b = profiler.getBaseline("m");
    expect(b).not.toBeNull();
    expect(b!.median).toBeCloseTo(5.5, 0);
    expect(b!.iqr).toBeGreaterThan(0);
  });

  it("should evict old observations when window exceeded", () => {
    const smallProfiler = new BaselineProfiler({ windowSize: 3 });
    [1, 2, 3, 4, 5].forEach((v) => smallProfiler.record("m", v));
    const b = smallProfiler.getBaseline("m");
    expect(b!.sampleCount).toBe(3);
    // Only last 3 values (3,4,5) should be in window
    expect(b!.mean).toBeCloseTo(4);
  });

  it("should clear a metric", () => {
    profiler.record("latency", 100);
    profiler.record("latency", 200);
    profiler.clear("latency");
    expect(profiler.getBaseline("latency")).toBeNull();
    expect(profiler.getMetrics()).not.toContain("latency");
  });

  it("should record batch observations", () => {
    profiler.recordBatch("m", [1, 2, 3, 4]);
    expect(profiler.getBaseline("m")!.sampleCount).toBe(4);
  });
});

describe("AlertRouter", () => {
  it("should dispatch alerts to registered handlers", async () => {
    const router = new AlertRouter({ deduplicationWindowMs: 0 });
    const handler = vi.fn();
    router.register(handler);

    await router.emit({
      metric: "latency",
      severity: "high",
      message: "Spike detected",
      value: 999,
      threshold: 200,
    });

    expect(handler).toHaveBeenCalledOnce();
    const alert = handler.mock.calls[0][0];
    expect(alert.metric).toBe("latency");
    expect(alert.severity).toBe("high");
  });

  it("should suppress duplicate alerts within deduplication window", async () => {
    const router = new AlertRouter({ deduplicationWindowMs: 60_000 });
    const handler = vi.fn();
    router.register(handler);

    await router.emit({ metric: "cpu", severity: "medium", message: "High CPU", value: 95, threshold: 80 });
    await router.emit({ metric: "cpu", severity: "medium", message: "High CPU", value: 97, threshold: 80 });

    // Second alert should be suppressed
    expect(handler).toHaveBeenCalledOnce();
  });

  it("should store alert history", async () => {
    const router = new AlertRouter({ deduplicationWindowMs: 0 });
    await router.emit({ metric: "errors", severity: "low", message: "Minor", value: 5, threshold: 3 });
    await router.emit({ metric: "latency", severity: "high", message: "Spike", value: 500, threshold: 100 });

    const history = router.getHistory();
    expect(history.length).toBe(2);
    // Most recent first
    expect(history[0].metric).toBe("latency");
  });

  it("should filter history by metric", async () => {
    const router = new AlertRouter({ deduplicationWindowMs: 0 });
    await router.emit({ metric: "errors", severity: "low", message: "Minor", value: 5, threshold: 3 });
    await router.emit({ metric: "latency", severity: "high", message: "Spike", value: 500, threshold: 100 });

    const latencyHistory = router.getHistory("latency");
    expect(latencyHistory).toHaveLength(1);
    expect(latencyHistory[0].metric).toBe("latency");
  });
});

describe("AnomalyDetector", () => {
  let profiler: BaselineProfiler;
  let router: AlertRouter;
  let contextBuilder: InvestigationContextBuilder;
  let detector: AnomalyDetector;

  beforeEach(() => {
    profiler = new BaselineProfiler({ windowSize: 200 });
    router = new AlertRouter({ deduplicationWindowMs: 0 });
    contextBuilder = new InvestigationContextBuilder();
    detector = new AnomalyDetector(profiler, router, contextBuilder, {
      zScoreThreshold: 3,
      iqrMultiplier: 1.5,
      method: "zscore",
    });
  });

  it("should not flag normal values as anomalies", async () => {
    // Feed normal distribution around 100
    for (let i = 0; i < 50; i++) {
      await detector.observe("latency", 100 + (Math.random() - 0.5) * 10);
    }
    // A value very close to the mean should be fine
    const result = await detector.observe("latency", 102);
    expect(result.isAnomaly).toBe(false);
  });

  it("should flag extreme outliers as anomalies", async () => {
    // Stable baseline around 100 with tiny variance
    for (let i = 0; i < 50; i++) {
      await detector.observe("latency", 100 + (i % 3) * 0.1);
    }
    // Inject a massive spike
    const result = await detector.observe("latency", 10_000);
    expect(result.isAnomaly).toBe(true);
    expect(result.method).toBe("zscore");
  });

  it("should emit an alert on anomaly detection", async () => {
    const handler = vi.fn();
    router.register(handler);

    for (let i = 0; i < 50; i++) {
      await detector.observe("latency", 100 + (i % 3) * 0.1);
    }
    await detector.observe("latency", 10_000);

    expect(handler).toHaveBeenCalled();
    const alert = handler.mock.calls[0][0];
    expect(alert.metric).toBe("latency");
    expect(["medium", "high", "critical"]).toContain(alert.severity);
  });

  it("should assemble investigation context on anomaly", async () => {
    for (let i = 0; i < 50; i++) {
      await detector.observe("latency", 100 + (i % 3) * 0.1);
    }
    const result = await detector.observe("latency", 10_000);

    expect(result.context).toBeDefined();
    expect(result.context!.zScore).not.toBeNull();
    expect(result.context!.summary).toContain("latency");
  });

  it("should not flag anomaly before baseline is established", async () => {
    // Only one observation — not enough for a baseline
    const result = await detector.observe("latency", 9999);
    expect(result.isAnomaly).toBe(false);
  });
});

describe("InvestigationContextBuilder", () => {
  it("should compute z-score in the context", () => {
    const builder = new InvestigationContextBuilder({ sampleLookback: 5 });

    const alert = {
      id: "a1",
      metric: "errors",
      severity: "high" as const,
      message: "Spike",
      value: 50,
      threshold: 10,
      detectedAt: new Date(),
    };

    const baseline = {
      mean: 5,
      stdDev: 2,
      q1: 4,
      median: 5,
      q3: 6,
      iqr: 2,
      sampleCount: 100,
    };

    const ctx = builder.build(alert, baseline);
    // z-score = (50 - 5) / 2 = 22.5
    expect(ctx.zScore).toBeCloseTo(22.5);
    expect(ctx.summary).toContain("errors");
    expect(ctx.summary).toContain("HIGH");
  });

  it("should include recent samples in context", () => {
    const builder = new InvestigationContextBuilder({ sampleLookback: 3 });
    const ts = new Date();
    builder.recordSample("cpu", 10, ts);
    builder.recordSample("cpu", 20, ts);
    builder.recordSample("cpu", 30, ts);

    const alert = {
      id: "a1",
      metric: "cpu",
      severity: "medium" as const,
      message: "High CPU",
      value: 90,
      threshold: 80,
      detectedAt: new Date(),
    };

    const ctx = builder.build(alert, null);
    expect(ctx.recentSamples).toHaveLength(3);
    expect(ctx.baseline).toBeNull();
    expect(ctx.zScore).toBeNull();
  });
});
