/**
 * Domain events for the agent system.
 * Events are immutable records of things that happened.
 */

export interface DomainEvent {
  id: string;
  type: string;
  timestamp: Date;
  payload: Record<string, unknown>;
  source: string;
}

export type AgentEventType =
  | "agent.started"
  | "agent.stopped"
  | "agent.error"
  | "task.created"
  | "task.assigned"
  | "task.completed"
  | "task.failed"
  | "message.received"
  | "message.sent"
  | "tool.called"
  | "tool.completed"
  | "tool.failed"
  | "memory.stored"
  | "memory.retrieved"
  | "session.created"
  | "session.ended"
  | "security.auth_success"
  | "security.auth_failure"
  | "security.rate_limited";

export interface AgentEvent extends DomainEvent {
  type: AgentEventType;
  agentId?: string;
  sessionId?: string;
}

export interface EventHandler<T extends DomainEvent = DomainEvent> {
  handle(event: T): Promise<void>;
}

export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T extends DomainEvent>(eventType: string, handler: EventHandler<T>): void;
  unsubscribe(eventType: string, handler: EventHandler): void;
}
