/**
 * Discovery Service — V2-07.
 * Queries the AgentRegistry to find agents that match a set of required
 * capabilities or a free-text semantic query. Results are scored and ranked
 * so callers always receive the best candidates first.
 */

import type { AgentRegistry } from "./agent-registry.js";
import type { AgentDescriptor, AgentCapabilityDescriptor } from "./agent-descriptor.js";

export interface CapabilityQuery {
  /** Required capability names. All must be present on the agent. */
  required?: string[];
  /**
   * Optional capability names. Agents that also have these are ranked higher.
   */
  preferred?: string[];
  /**
   * Free-text tags. Agents whose capability tags overlap score higher.
   */
  tags?: string[];
  /**
   * Only return agents in this namespace. Defaults to "default".
   * Use "*" to search across all namespaces.
   */
  namespace?: string;
  /**
   * Exclude agents with status "unhealthy". Default: true.
   */
  excludeUnhealthy?: boolean;
  /** Maximum number of results to return. Default: 10. */
  limit?: number;
}

export interface DiscoveryResult {
  descriptor: AgentDescriptor;
  /** Normalised match score in [0, 1]. Higher is better. */
  score: number;
  /** Names of matched required capabilities. */
  matchedRequired: string[];
  /** Names of matched preferred capabilities. */
  matchedPreferred: string[];
}

export class DiscoveryService {
  constructor(private readonly registry: AgentRegistry) {}

  /**
   * Find agents that satisfy a capability query.
   * Agents that lack any required capability are excluded.
   * Results are sorted by descending score.
   */
  find(query: CapabilityQuery): DiscoveryResult[] {
    const namespace = query.namespace ?? "default";
    const excludeUnhealthy = query.excludeUnhealthy ?? true;
    const limit = query.limit ?? 10;

    let candidates = this.registry.list(namespace);

    if (excludeUnhealthy) {
      candidates = candidates.filter((a) => a.status !== "unhealthy");
    }

    const results: DiscoveryResult[] = [];

    for (const descriptor of candidates) {
      const capabilityNames = new Set(descriptor.capabilities.map((c) => c.name));
      const required = query.required ?? [];
      const preferred = query.preferred ?? [];
      const tags = query.tags ?? [];

      // Hard filter: all required capabilities must be present
      const matchedRequired = required.filter((r) => capabilityNames.has(r));
      if (matchedRequired.length < required.length) continue;

      // Score: preferred capability hits
      const matchedPreferred = preferred.filter((p) => capabilityNames.has(p));

      // Tag overlap score
      const agentTags = new Set(descriptor.capabilities.flatMap((c) => c.tags));
      const tagHits = tags.filter((t) => agentTags.has(t)).length;

      // Confidence bonus: average confidence of matched capabilities
      const matchedCaps: AgentCapabilityDescriptor[] = descriptor.capabilities.filter((c) =>
        required.includes(c.name)
      );
      const avgConfidence =
        matchedCaps.length > 0
          ? matchedCaps.reduce((sum, c) => sum + (c.confidence ?? 0.5), 0) / matchedCaps.length
          : 0.5;

      // Health bonus
      const healthBonus =
        descriptor.status === "healthy" ? 0.2 : descriptor.status === "degraded" ? 0.05 : 0;

      const maxScore =
        1 /* required */ +
        (preferred.length > 0 ? 0.3 : 0) +
        (tags.length > 0 ? 0.2 : 0) +
        0.2 /* confidence */ +
        0.2; /* health */

      const raw =
        (required.length > 0 ? 1 : 0) +
        (preferred.length > 0 ? (matchedPreferred.length / preferred.length) * 0.3 : 0) +
        (tags.length > 0 ? (tagHits / tags.length) * 0.2 : 0) +
        avgConfidence * 0.2 +
        healthBonus;

      const score = maxScore > 0 ? Math.min(raw / maxScore, 1) : 0;

      results.push({ descriptor, score, matchedRequired, matchedPreferred });
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, limit);
  }

  /**
   * Convenience: return the single best matching agent or undefined.
   */
  findBest(query: CapabilityQuery): DiscoveryResult | undefined {
    return this.find({ ...query, limit: 1 })[0];
  }

  /**
   * Convenience: list all agents that advertise a specific capability.
   */
  findByCapability(capabilityName: string, namespace = "default"): DiscoveryResult[] {
    return this.find({ required: [capabilityName], namespace });
  }
}
