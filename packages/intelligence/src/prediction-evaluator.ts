/**
 * Prediction evaluator.
 * Tracks prediction accuracy (precision / recall) by comparing predicted
 * next actions against what actually happened. Provides a feedback loop
 * so callers can tune confidence thresholds over time.
 */

import type { ActionType } from "./behavior-tracker.js";

export interface PredictionRecord {
  id: string;
  userId: string;
  predictedAction: ActionType;
  confidence: number;
  createdAt: Date;
  /** Set when the actual next action is observed. */
  actualAction?: ActionType;
  /** Derived from predictedAction === actualAction once resolved. */
  correct?: boolean;
  resolvedAt?: Date;
}

export interface EvaluationSummary {
  totalPredictions: number;
  resolvedPredictions: number;
  correctPredictions: number;
  precision: number;
  /** Fraction of resolved predictions that were correct. */
  accuracy: number;
}

/**
 * Stores pending predictions and resolves them against observed outcomes.
 */
export class PredictionEvaluator {
  private readonly records = new Map<string, PredictionRecord>();

  /**
   * Register a new prediction before the outcome is known.
   * Returns the prediction id that must be passed to `resolve()`.
   */
  record(userId: string, predictedAction: ActionType, confidence: number): string {
    const id = crypto.randomUUID();
    this.records.set(id, {
      id,
      userId,
      predictedAction,
      confidence,
      createdAt: new Date(),
    });
    return id;
  }

  /**
   * Resolve a prediction once the user's actual next action is known.
   * Marks the record as correct or incorrect.
   */
  resolve(predictionId: string, actualAction: ActionType): void {
    const record = this.records.get(predictionId);
    if (!record) return;

    record.actualAction = actualAction;
    record.correct = record.predictedAction === actualAction;
    record.resolvedAt = new Date();
  }

  /**
   * Return an accuracy summary for a specific user.
   * All-time statistics are returned when no user is specified.
   */
  summarize(userId?: string): EvaluationSummary {
    const allRecords = Array.from(this.records.values()).filter(
      (r) => !userId || r.userId === userId
    );

    const resolved = allRecords.filter((r) => r.resolvedAt !== undefined);
    const correct = resolved.filter((r) => r.correct === true);

    const precision = resolved.length > 0 ? correct.length / resolved.length : 0;

    return {
      totalPredictions: allRecords.length,
      resolvedPredictions: resolved.length,
      correctPredictions: correct.length,
      precision,
      accuracy: precision, // accuracy == precision for binary correct/incorrect classification
    };
  }

  /**
   * Return all unresolved predictions for a user.
   */
  getPendingPredictions(userId: string): PredictionRecord[] {
    return Array.from(this.records.values()).filter(
      (r) => r.userId === userId && r.resolvedAt === undefined
    );
  }

  /**
   * Remove all records older than `maxAgeMs` milliseconds to prevent unbounded growth.
   */
  prune(maxAgeMs: number): number {
    const cutoff = Date.now() - maxAgeMs;
    let pruned = 0;
    for (const [id, record] of this.records) {
      if (record.createdAt.getTime() < cutoff) {
        this.records.delete(id);
        pruned++;
      }
    }
    return pruned;
  }
}
