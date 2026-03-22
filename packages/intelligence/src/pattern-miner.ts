/**
 * Pattern miner.
 * Analyses a user's behavioral event history and identifies recurring
 * action sequences. Each discovered pattern carries a support count
 * (how often it appears) that the prediction engine can use as a
 * confidence signal.
 */

import type { BehavioralEvent, ActionType } from "./behavior-tracker.js";

export interface ActionPattern {
  /** Ordered sequence of action types that make up the pattern. */
  sequence: ActionType[];
  /** Number of times this exact sequence was observed. */
  support: number;
  /** Ratio of occurrences relative to the total number of sequences examined. */
  confidence: number;
  /** Most recent timestamp at which the pattern was observed. */
  lastSeenAt: Date;
}

export interface PatternMinerConfig {
  /** Minimum number of times a sequence must appear to be considered a pattern. */
  minSupport?: number;
  /** Length of sliding window (in events) used to extract sequences. */
  windowSize?: number;
  /** Maximum sequence length to consider. */
  maxSequenceLength?: number;
}

/**
 * Mines recurring action sequences from a list of behavioral events.
 * Uses a sliding-window approach: for every position in the event stream,
 * all sub-sequences up to maxSequenceLength are extracted and counted.
 */
export class PatternMiner {
  private readonly minSupport: number;
  private readonly windowSize: number;
  private readonly maxSequenceLength: number;

  constructor(config: PatternMinerConfig = {}) {
    this.minSupport = config.minSupport ?? 2;
    this.windowSize = config.windowSize ?? 50;
    this.maxSequenceLength = config.maxSequenceLength ?? 4;
  }

  /**
   * Extract recurring patterns from the provided event list.
   * Only events within the most recent `windowSize` are examined.
   */
  mine(events: BehavioralEvent[]): ActionPattern[] {
    const window = events.slice(-this.windowSize);
    if (window.length < 2) return [];

    const actions = window.map((e) => e.action);
    const counts = new Map<string, { support: number; lastSeenAt: Date }>();

    // Extract all sub-sequences up to maxSequenceLength
    for (let i = 0; i < actions.length; i++) {
      for (let len = 2; len <= this.maxSequenceLength && i + len <= actions.length; len++) {
        const seq = actions.slice(i, i + len);
        const key = seq.join("|");

        const existing = counts.get(key);
        const ts = window[i + len - 1].timestamp;

        if (existing) {
          existing.support++;
          if (ts > existing.lastSeenAt) {
            existing.lastSeenAt = ts;
          }
        } else {
          counts.set(key, { support: 1, lastSeenAt: ts });
        }
      }
    }

    // Total possible positions for normalising confidence
    const totalPositions = Math.max(1, actions.length - 1);

    const patterns: ActionPattern[] = [];
    for (const [key, { support, lastSeenAt }] of counts) {
      if (support < this.minSupport) continue;

      patterns.push({
        sequence: key.split("|") as ActionType[],
        support,
        confidence: Math.min(1.0, support / totalPositions),
        lastSeenAt,
      });
    }

    // Sort by support descending so the strongest patterns come first
    return patterns.sort((a, b) => b.support - a.support);
  }

  /**
   * Filter a mined pattern list to those that begin with a given action.
   * Useful for asking "what typically follows action X?".
   */
  filterByPrefix(patterns: ActionPattern[], prefix: ActionType): ActionPattern[] {
    return patterns.filter((p) => p.sequence[0] === prefix);
  }
}
