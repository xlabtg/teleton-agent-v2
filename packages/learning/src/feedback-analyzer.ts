/**
 * Feedback analyzer — V2-19.
 * Identifies recurring patterns in collected feedback and surfaces
 * actionable insights: which action categories produce the most negative
 * signals, which agents have the lowest satisfaction rates, and which
 * time periods are problematic.
 */

import type { FeedbackCollector, FeedbackEntry, ExplicitRating } from "./feedback-collector.js";

export interface CategoryStats {
  actionCategory: string;
  total: number;
  positiveCount: number;
  negativeCount: number;
  implicitNegativeCount: number;
  /** Satisfaction score: positiveCount / total (0–1). */
  satisfactionRate: number;
}

export interface AgentStats {
  agentId: string;
  total: number;
  satisfactionRate: number;
}

export interface FeedbackTrend {
  /** ISO date string (YYYY-MM-DD). */
  date: string;
  total: number;
  negativeRate: number;
}

export interface FeedbackReport {
  totalEntries: number;
  overallSatisfactionRate: number;
  byCategory: CategoryStats[];
  byAgent: AgentStats[];
  /** Daily trend for the queried window, sorted oldest-first. */
  dailyTrend: FeedbackTrend[];
}

export interface FeedbackAnalyzerConfig {
  /** Minimum number of data points required before a category is included in reports. */
  minSampleSize?: number;
}

const NEGATIVE_RATINGS: ExplicitRating[] = ["thumbs_down"];

function isNegative(entry: FeedbackEntry): boolean {
  if (entry.feedback.type === "explicit") {
    return NEGATIVE_RATINGS.includes(entry.feedback.rating);
  }
  // All implicit signals are treated as negative
  return true;
}

function isPositive(entry: FeedbackEntry): boolean {
  return entry.feedback.type === "explicit" && entry.feedback.rating === "thumbs_up";
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Analyses feedback entries from a FeedbackCollector and produces structured
 * insight reports.  All computations are performed eagerly (no caching) so
 * reports always reflect the current state of the collector.
 */
export class FeedbackAnalyzer {
  private readonly collector: FeedbackCollector;
  private readonly minSampleSize: number;

  constructor(collector: FeedbackCollector, config: FeedbackAnalyzerConfig = {}) {
    this.collector = collector;
    this.minSampleSize = config.minSampleSize ?? 1;
  }

  /** Compute stats per action category. */
  analyzeByCategory(entries?: FeedbackEntry[]): CategoryStats[] {
    const data = entries ?? this.collector.getAll();
    const map = new Map<string, CategoryStats>();

    for (const entry of data) {
      let stats = map.get(entry.actionCategory);
      if (!stats) {
        stats = {
          actionCategory: entry.actionCategory,
          total: 0,
          positiveCount: 0,
          negativeCount: 0,
          implicitNegativeCount: 0,
          satisfactionRate: 0,
        };
        map.set(entry.actionCategory, stats);
      }

      stats.total++;
      if (isPositive(entry)) stats.positiveCount++;
      if (isNegative(entry)) {
        stats.negativeCount++;
        if (entry.feedback.type === "implicit") stats.implicitNegativeCount++;
      }
    }

    for (const stats of map.values()) {
      stats.satisfactionRate = stats.total > 0 ? stats.positiveCount / stats.total : 0;
    }

    return [...map.values()]
      .filter((s) => s.total >= this.minSampleSize)
      .sort((a, b) => a.satisfactionRate - b.satisfactionRate);
  }

  /** Compute stats per agent. */
  analyzeByAgent(entries?: FeedbackEntry[]): AgentStats[] {
    const data = entries ?? this.collector.getAll();
    const map = new Map<string, { total: number; positive: number }>();

    for (const entry of data) {
      const cur = map.get(entry.agentId) ?? { total: 0, positive: 0 };
      cur.total++;
      if (isPositive(entry)) cur.positive++;
      map.set(entry.agentId, cur);
    }

    return [...map.entries()]
      .filter(([, v]) => v.total >= this.minSampleSize)
      .map(([agentId, v]) => ({
        agentId,
        total: v.total,
        satisfactionRate: v.positive / v.total,
      }))
      .sort((a, b) => a.satisfactionRate - b.satisfactionRate);
  }

  /** Compute daily negative rate for a time window. */
  dailyTrend(from: Date, to: Date): FeedbackTrend[] {
    const data = this.collector.getInTimeRange(from, to);
    const map = new Map<string, { total: number; negative: number }>();

    for (const entry of data) {
      const day = toIsoDate(entry.timestamp);
      const cur = map.get(day) ?? { total: 0, negative: 0 };
      cur.total++;
      if (isNegative(entry)) cur.negative++;
      map.set(day, cur);
    }

    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, v]) => ({
        date,
        total: v.total,
        negativeRate: v.total > 0 ? v.negative / v.total : 0,
      }));
  }

  /**
   * Return a full report for a time window.
   * Pass `from` and `to` to limit the analysis; omit to analyse all data.
   */
  report(from?: Date, to?: Date): FeedbackReport {
    const allData = this.collector.getAll();
    const data =
      from && to ? allData.filter((e) => e.timestamp >= from && e.timestamp <= to) : allData;

    const totalPositive = data.filter(isPositive).length;
    const overallSatisfactionRate = data.length > 0 ? totalPositive / data.length : 0;

    return {
      totalEntries: data.length,
      overallSatisfactionRate,
      byCategory: this.analyzeByCategory(data),
      byAgent: this.analyzeByAgent(data),
      dailyTrend: from && to ? this.dailyTrend(from, to) : [],
    };
  }

  /**
   * Return categories whose satisfaction rate falls below a threshold.
   * Useful for triggering automated strategy adjustments.
   */
  lowSatisfactionCategories(threshold = 0.5): CategoryStats[] {
    return this.analyzeByCategory().filter((s) => s.satisfactionRate < threshold);
  }
}
