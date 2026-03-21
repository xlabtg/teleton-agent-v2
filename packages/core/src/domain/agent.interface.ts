/**
 * Core agent domain interfaces.
 * These define the contract for all agent implementations
 * and are independent of any infrastructure concerns.
 */

export type AgentRole = "orchestrator" | "executor" | "observer" | "specialist";

export interface Capability {
  name: string;
  description: string;
  scope: string;
}

export interface Constraint {
  type: "rate_limit" | "permission" | "resource" | "timeout";
  value: unknown;
}

export interface AgentContext {
  sessionId: string;
  userId: string;
  conversationHistory: Message[];
  memory: MemoryEntry[];
  availableTools: ToolDefinition[];
  timestamp: Date;
}

export interface Message {
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: Date;
  metadata?: Record<string, unknown>;
}

export interface MemoryEntry {
  id: string;
  content: string;
  embedding?: number[];
  importance: number;
  createdAt: Date;
  accessedAt: Date;
  tags: string[];
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  scope: string;
}

export interface Thought {
  reasoning: string;
  selectedAction: string;
  confidence: number;
  alternatives: string[];
}

export interface Action {
  type: "tool_call" | "message" | "delegate" | "wait";
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  message?: string;
  delegateTo?: string;
}

export interface ActionResult {
  success: boolean;
  output: unknown;
  error?: string;
  duration: number;
}

export interface Observation {
  summary: string;
  shouldContinue: boolean;
  nextAction?: Action;
}

export interface IAgent {
  id: string;
  role: AgentRole;
  capabilities: Capability[];
  constraints: Constraint[];

  think(context: AgentContext): Promise<Thought>;
  act(thought: Thought): Promise<Action>;
  observe(result: ActionResult): Promise<Observation>;
}

export interface TaskPriority {
  level: "critical" | "high" | "normal" | "low";
  weight: number;
}

export interface Task {
  id: string;
  name: string;
  payload: Record<string, unknown>;
  priority: TaskPriority;
  createdAt: Date;
  deadline?: Date;
  assignedAgent?: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "cancelled";
}

export interface TaskResult {
  taskId: string;
  success: boolean;
  output: unknown;
  error?: string;
  executionTime: number;
  agentId: string;
}
