/**
 * Agent Descriptor — V2-07.
 * Defines the schema for describing an agent's identity, capabilities,
 * versioning, and health endpoint. Used by the registry and discovery service.
 */

export type AgentStatus = "healthy" | "degraded" | "unhealthy" | "unknown";

export interface AgentCapabilityDescriptor {
  /** Unique capability identifier, e.g. "code-review", "ton-transfer". */
  name: string;
  /** Human-readable description of what this capability does. */
  description: string;
  /** Semantic version of this capability implementation. */
  version: string;
  /**
   * Free-form tags used for semantic discovery queries,
   * e.g. ["blockchain", "defi", "swap"].
   */
  tags: string[];
  /**
   * Optional score (0–1) representing how well the agent handles this
   * capability relative to peers. Higher = more confident.
   */
  confidence?: number;
}

export interface AgentDescriptor {
  /** Globally unique agent identifier. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Semver for the agent implementation. */
  version: string;
  /** Namespace for multi-tenant isolation, e.g. "org.team". */
  namespace: string;
  /** List of capabilities advertised by this agent. */
  capabilities: AgentCapabilityDescriptor[];
  /**
   * URL or identifier of the agent's health endpoint.
   * The health checker calls this to determine liveness.
   */
  healthEndpoint?: string;
  /** Date when the agent registered. */
  registeredAt: Date;
  /** Date of the last status update. */
  updatedAt: Date;
  /** Current availability status. */
  status: AgentStatus;
  /** Arbitrary metadata for operator use (e.g. deployment region, owner). */
  metadata: Record<string, unknown>;
}

export interface RegisterAgentInput {
  id: string;
  name: string;
  version: string;
  namespace?: string;
  capabilities: AgentCapabilityDescriptor[];
  healthEndpoint?: string;
  metadata?: Record<string, unknown>;
}
