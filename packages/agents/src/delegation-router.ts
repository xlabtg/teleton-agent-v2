/**
 * Delegation Router — V2-08.
 * Routes each subtask (from the TaskDecomposer) to the best available agent
 * using the CapabilityMatcher. Supports pluggable routing strategies and
 * timeout/fallback handling.
 *
 * Routing strategies:
 *  - "best-fit"     (default) – highest capability match score wins
 *  - "round-robin"  – cycles through capable agents for load spreading
 *  - "random"       – picks a random capable agent (useful for A/B tests)
 */

import type { AgentRegistry } from "./agent-registry.js";
import { CapabilityMatcher } from "./capability-matcher.js";
import type { SubTask } from "./task-decomposer.js";

export type RoutingStrategy = "best-fit" | "round-robin" | "random";

export interface DelegationRouterConfig {
  strategy?: RoutingStrategy;
  /**
   * Maximum time in milliseconds to wait for a delegate to accept the task.
   * Default: 5_000.
   */
  timeoutMs?: number;
  /**
   * Namespace to use when querying the registry for capable agents.
   * Default: "default".
   */
  namespace?: string;
}

export interface RoutingDecision {
  subtaskId: string;
  assignedAgentId: string | null;
  /** Null when no capable agent was found. */
  reason: string;
  score: number;
}

export class DelegationRouter {
  private readonly registry: AgentRegistry;
  private readonly matcher: CapabilityMatcher;
  private readonly strategy: RoutingStrategy;
  private readonly timeoutMs: number;
  private readonly namespace: string;
  /** Round-robin cursor: maps capability → next index. */
  private readonly rrCursors = new Map<string, number>();

  constructor(registry: AgentRegistry, config: DelegationRouterConfig = {}) {
    this.registry = registry;
    this.matcher = new CapabilityMatcher();
    this.strategy = config.strategy ?? "best-fit";
    this.timeoutMs = config.timeoutMs ?? 5_000;
    this.namespace = config.namespace ?? "default";
  }

  /**
   * Decide which agent should handle each subtask.
   * Does NOT execute the subtask — execution is the pipeline's responsibility.
   */
  route(subtasks: SubTask[]): RoutingDecision[] {
    return subtasks.map((subtask) => this.routeOne(subtask));
  }

  /** Route a single subtask and return the decision. */
  routeOne(subtask: SubTask): RoutingDecision {
    const agents = this.registry.list(this.namespace).filter((a) => a.status !== "unhealthy");

    const ranked = this.matcher.rank(agents, subtask.requiredCapability);

    if (ranked.length === 0) {
      return {
        subtaskId: subtask.id,
        assignedAgentId: null,
        reason: `No agent capable of "${subtask.requiredCapability}" is available`,
        score: 0,
      };
    }

    let chosen = ranked[0];

    if (this.strategy === "round-robin") {
      const cursor = this.rrCursors.get(subtask.requiredCapability) ?? 0;
      chosen = ranked[cursor % ranked.length];
      this.rrCursors.set(subtask.requiredCapability, cursor + 1);
    } else if (this.strategy === "random") {
      chosen = ranked[Math.floor(Math.random() * ranked.length)];
    }

    return {
      subtaskId: subtask.id,
      assignedAgentId: chosen.agentId,
      reason: `Matched via "${this.strategy}" (score=${chosen.score.toFixed(3)})`,
      score: chosen.score,
    };
  }

  get configuredTimeoutMs(): number {
    return this.timeoutMs;
  }
}
