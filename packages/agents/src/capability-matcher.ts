/**
 * Capability Matcher — V2-08.
 * Scores a set of agent descriptors against a required capability name and
 * returns a ranked list. Used by the DelegationRouter to pick the best
 * available agent for each subtask.
 */

import type { AgentDescriptor } from "./agent-descriptor.js";

export interface MatchResult {
  agentId: string;
  agentName: string;
  /** Normalised score in [0, 1]. Higher is better. */
  score: number;
  /** The matched capability descriptor, if found. */
  matchedCapabilityVersion: string | undefined;
}

export interface CapabilityMatcherConfig {
  /**
   * Weight applied to the capability confidence field when computing the
   * composite score. Default: 0.6.
   */
  confidenceWeight?: number;
  /**
   * Weight applied to the agent health bonus. Default: 0.4.
   */
  healthWeight?: number;
}

export class CapabilityMatcher {
  private readonly confidenceWeight: number;
  private readonly healthWeight: number;

  constructor(config: CapabilityMatcherConfig = {}) {
    this.confidenceWeight = config.confidenceWeight ?? 0.6;
    this.healthWeight = config.healthWeight ?? 0.4;
  }

  /**
   * Rank a list of agents by how well they match a required capability name.
   * Agents that do not expose the capability at all are excluded.
   */
  rank(agents: AgentDescriptor[], requiredCapability: string): MatchResult[] {
    const results: MatchResult[] = [];

    for (const agent of agents) {
      const cap = agent.capabilities.find((c) => c.name === requiredCapability);
      if (!cap) continue;

      const confidence = cap.confidence ?? 0.5;
      const healthBonus = agent.status === "healthy" ? 1 : agent.status === "degraded" ? 0.4 : 0;

      const score = confidence * this.confidenceWeight + healthBonus * this.healthWeight;

      results.push({
        agentId: agent.id,
        agentName: agent.name,
        score: Math.min(score, 1),
        matchedCapabilityVersion: cap.version,
      });
    }

    results.sort((a, b) => b.score - a.score);
    return results;
  }

  /** Return only the best-matching agent, or undefined if none match. */
  best(agents: AgentDescriptor[], requiredCapability: string): MatchResult | undefined {
    return this.rank(agents, requiredCapability)[0];
  }
}
