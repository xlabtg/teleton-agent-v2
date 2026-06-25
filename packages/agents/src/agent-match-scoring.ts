import type { AgentDescriptor } from "./agent-descriptor.js";

export interface AgentMatchScore {
  healthTier: number;
  healthScore: number;
  score: number;
}

export function getAgentHealthScore(status: AgentDescriptor["status"]): number {
  if (status === "healthy") return 1;
  if (status === "degraded") return 0.4;
  return 0;
}

export function scoreAgentCapability(
  agent: AgentDescriptor,
  confidence: number,
  confidenceWeight = 0.6,
  healthWeight = 0.4
): AgentMatchScore {
  const healthScore = getAgentHealthScore(agent.status);
  const score = confidence * confidenceWeight + healthScore * healthWeight;

  return createAgentMatchScore(agent, Math.min(score, 1));
}

export function createAgentMatchScore(agent: AgentDescriptor, score: number): AgentMatchScore {
  const healthScore = getAgentHealthScore(agent.status);

  return {
    healthTier: healthScore,
    healthScore,
    score,
  };
}

export function compareAgentCapabilityScores(
  left: AgentMatchScore,
  right: AgentMatchScore
): number {
  return right.healthTier - left.healthTier || right.score - left.score;
}
