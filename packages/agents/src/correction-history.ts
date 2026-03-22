/**
 * Correction History — V2-10.
 * Stores a record of every self-correction attempt so that:
 *  - Patterns of failures can be analysed offline.
 *  - Future attempts can be informed by what worked previously.
 *  - Circuit-breakers can detect repeated failure loops.
 */

import type { ErrorCategory } from "./error-classifier.js";

export interface CorrectionRecord {
  id: string;
  operationName: string;
  errorCategory: ErrorCategory;
  errorMessage: string;
  attempt: number;
  strategyDescription: string;
  succeeded: boolean;
  recordedAt: Date;
}

export interface CorrectionHistoryConfig {
  /**
   * Maximum number of records to keep per operation name.
   * Oldest records are evicted. Default: 100.
   */
  maxRecordsPerOperation?: number;
}

export class CorrectionHistory {
  /** Map: operationName → records (oldest first). */
  private readonly records = new Map<string, CorrectionRecord[]>();
  private readonly maxRecordsPerOperation: number;

  constructor(config: CorrectionHistoryConfig = {}) {
    this.maxRecordsPerOperation = config.maxRecordsPerOperation ?? 100;
  }

  /** Record a correction attempt outcome. */
  record(entry: Omit<CorrectionRecord, "id" | "recordedAt">): CorrectionRecord {
    const record: CorrectionRecord = {
      ...entry,
      id: crypto.randomUUID(),
      recordedAt: new Date(),
    };

    const existing = this.records.get(entry.operationName) ?? [];
    existing.push(record);

    if (existing.length > this.maxRecordsPerOperation) {
      existing.splice(0, existing.length - this.maxRecordsPerOperation);
    }

    this.records.set(entry.operationName, existing);
    return record;
  }

  /** All records for a given operation, newest first. */
  getForOperation(operationName: string): CorrectionRecord[] {
    return [...(this.records.get(operationName) ?? [])].reverse();
  }

  /**
   * Count the number of consecutive failures for an operation.
   * Stops counting as soon as a successful record is encountered (newest first).
   */
  consecutiveFailures(operationName: string): number {
    const records = this.getForOperation(operationName);
    let count = 0;
    for (const r of records) {
      if (r.succeeded) break;
      count++;
    }
    return count;
  }

  /**
   * Returns the most recently successful strategy description for an operation
   * and error category. Useful for surfacing "what worked last time".
   */
  lastSuccessfulStrategy(operationName: string, category: ErrorCategory): string | undefined {
    const records = this.getForOperation(operationName);
    return records.find((r) => r.succeeded && r.errorCategory === category)?.strategyDescription;
  }

  /** Total number of correction records across all operations. */
  get totalRecords(): number {
    return Array.from(this.records.values()).reduce((sum, arr) => sum + arr.length, 0);
  }

  /** Clear all history (useful for testing). */
  clear(): void {
    this.records.clear();
  }
}
