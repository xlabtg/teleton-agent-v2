/**
 * Strategy adjuster — V2-19.
 * Translates feedback analysis into concrete behaviour changes: updated
 * prompt templates, alternative tool preferences, and adjusted routing hints.
 *
 * A rollback log is kept so that any strategy change can be reverted if it
 * causes a performance regression.
 */

export type ToolPreference = "prefer" | "avoid" | "neutral";

export interface PromptOverride {
  /** Template key this override applies to. */
  templateKey: string;
  /** Replacement template text (may contain {{variable}} placeholders). */
  template: string;
}

export interface ToolPreferenceOverride {
  toolName: string;
  preference: ToolPreference;
}

export interface RoutingHint {
  /** The action category this hint applies to. */
  actionCategory: string;
  /** Preferred agent ID to route matching requests to. */
  preferredAgentId: string;
}

export interface Strategy {
  id: string;
  /** Human-readable label for review purposes. */
  label: string;
  promptOverrides: PromptOverride[];
  toolPreferences: ToolPreferenceOverride[];
  routingHints: RoutingHint[];
  createdAt: Date;
}

export interface StrategyAdjustment {
  id: string;
  strategyId: string;
  reason: string;
  appliedAt: Date;
  /** Strategy that was active before this adjustment (for rollback). */
  previousStrategyId: string | null;
}

export interface StrategyAdjusterConfig {
  /** Maximum number of historical adjustments to retain. */
  maxHistorySize?: number;
}

/**
 * Maintains the active strategy and a history of adjustments.
 * Clients read the active strategy to decide how to construct prompts,
 * select tools, and route requests.
 */
export class StrategyAdjuster {
  private strategies = new Map<string, Strategy>();
  private adjustments: StrategyAdjustment[] = [];
  private activeStrategyId: string | null = null;
  private readonly maxHistorySize: number;

  constructor(config: StrategyAdjusterConfig = {}) {
    this.maxHistorySize = config.maxHistorySize ?? 500;
  }

  /** Register a new strategy (does not activate it). */
  registerStrategy(strategy: Omit<Strategy, "id" | "createdAt">): Strategy {
    const stored: Strategy = {
      ...strategy,
      id: crypto.randomUUID(),
      createdAt: new Date(),
    };
    this.strategies.set(stored.id, stored);
    return stored;
  }

  /** Activate a previously registered strategy and record the adjustment. */
  applyStrategy(strategyId: string, reason: string): StrategyAdjustment {
    if (!this.strategies.has(strategyId)) {
      throw new Error(`Strategy '${strategyId}' not found`);
    }

    const adjustment: StrategyAdjustment = {
      id: crypto.randomUUID(),
      strategyId,
      reason,
      appliedAt: new Date(),
      previousStrategyId: this.activeStrategyId,
    };

    this.activeStrategyId = strategyId;
    this.adjustments.push(adjustment);

    // Trim history
    if (this.adjustments.length > this.maxHistorySize) {
      this.adjustments.shift();
    }

    return adjustment;
  }

  /**
   * Rollback to the strategy that was active before the most recent
   * adjustment.  Returns null if there is nothing to roll back to.
   */
  rollback(reason = "manual rollback"): StrategyAdjustment | null {
    if (this.adjustments.length === 0) return null;

    const last = this.adjustments[this.adjustments.length - 1];
    if (last.previousStrategyId === null) {
      // Was the initial state — clear active strategy
      this.activeStrategyId = null;
      return null;
    }

    return this.applyStrategy(last.previousStrategyId, reason);
  }

  /** Return the currently active strategy, or null if none is set. */
  getActiveStrategy(): Strategy | null {
    if (this.activeStrategyId === null) return null;
    return this.strategies.get(this.activeStrategyId) ?? null;
  }

  /** Return a strategy by ID. */
  getStrategy(id: string): Strategy | undefined {
    return this.strategies.get(id);
  }

  /** Return all registered strategies. */
  listStrategies(): Strategy[] {
    return [...this.strategies.values()];
  }

  /** Return the full adjustment history, newest first. */
  getAdjustmentHistory(): StrategyAdjustment[] {
    return [...this.adjustments].reverse();
  }

  /**
   * Resolve the effective prompt template for a given key.
   * Falls back to the provided default if no override exists.
   */
  resolvePromptTemplate(templateKey: string, defaultTemplate: string): string {
    const strategy = this.getActiveStrategy();
    if (!strategy) return defaultTemplate;

    const override = strategy.promptOverrides.find((o) => o.templateKey === templateKey);
    return override?.template ?? defaultTemplate;
  }

  /**
   * Return the tool preference for a given tool name under the active strategy.
   * Returns 'neutral' if no strategy is active or no preference is set.
   */
  resolveToolPreference(toolName: string): ToolPreference {
    const strategy = this.getActiveStrategy();
    if (!strategy) return "neutral";

    const override = strategy.toolPreferences.find((p) => p.toolName === toolName);
    return override?.preference ?? "neutral";
  }

  /**
   * Return the preferred agent ID for an action category, or null if none.
   */
  resolvePreferredAgent(actionCategory: string): string | null {
    const strategy = this.getActiveStrategy();
    if (!strategy) return null;

    const hint = strategy.routingHints.find((h) => h.actionCategory === actionCategory);
    return hint?.preferredAgentId ?? null;
  }
}
