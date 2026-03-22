/**
 * Cache warmer.
 * Pre-computes responses for queries the prediction engine considers likely
 * so they are ready in the cache before the user asks.
 * Runs asynchronously and never blocks the main response path.
 */

import type { PredictionEngine } from "./prediction-engine.js";
import type { PredictiveCache } from "./predictive-cache.js";

export type ResponseGenerator = (query: string) => Promise<string>;

export interface CacheWarmerConfig {
  /** Only warm cache entries for predictions above this confidence score. */
  minConfidence?: number;
}

/**
 * Schedules background cache-warming tasks driven by the prediction engine.
 *
 * Usage pattern:
 *  1. After each user interaction, call `warmForUser(userId, responseGenerator)`.
 *  2. The warmer asks the prediction engine what comes next.
 *  3. For each high-confidence prediction a response is pre-generated and stored
 *     in the cache under a query derived from the predicted action.
 *  4. Warming runs on a background promise — callers do NOT await it.
 */
export class CacheWarmer {
  private readonly minConfidence: number;

  constructor(
    private readonly predictionEngine: PredictionEngine,
    private readonly cache: PredictiveCache,
    config: CacheWarmerConfig = {}
  ) {
    this.minConfidence = config.minConfidence ?? 0.5;
  }

  /**
   * Trigger background pre-warming for a user.
   * Returns a promise that resolves when warming completes (or fails silently).
   * This promise is intentionally not awaited by callers on the hot path.
   */
  warmForUser(userId: string, generateResponse: ResponseGenerator): Promise<void> {
    // Fire-and-forget; errors are swallowed so warming never breaks the main flow
    return this.doWarm(userId, generateResponse).catch(() => {
      // Warming failures are non-fatal
    });
  }

  private async doWarm(userId: string, generateResponse: ResponseGenerator): Promise<void> {
    const predictions = this.predictionEngine.predict(userId);

    for (const prediction of predictions) {
      if (prediction.confidence < this.minConfidence) continue;

      // Derive a canonical query string from the predicted action
      const syntheticQuery = `action:${prediction.action}`;

      const alreadyCached = await this.cache.get(syntheticQuery);
      if (alreadyCached !== null) continue;

      const response = await generateResponse(syntheticQuery);
      await this.cache.set(syntheticQuery, response);
    }
  }
}
