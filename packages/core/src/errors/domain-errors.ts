/**
 * Domain-specific error hierarchy.
 * All errors extend DomainError for consistent handling.
 */

export class DomainError extends Error {
  public readonly code: string;
  public readonly statusCode: number;

  constructor(message: string, code: string, statusCode: number = 500) {
    super(message);
    this.name = this.constructor.name;
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super(`${entity} with id '${id}' not found`, "NOT_FOUND", 404);
  }
}

export class ValidationError extends DomainError {
  public readonly details: Record<string, string[]>;

  constructor(message: string, details: Record<string, string[]> = {}) {
    super(message, "VALIDATION_ERROR", 400);
    this.details = details;
  }
}

export class AuthenticationError extends DomainError {
  constructor(message: string = "Authentication required") {
    super(message, "AUTHENTICATION_ERROR", 401);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string = "Insufficient permissions") {
    super(message, "FORBIDDEN", 403);
  }
}

export class RateLimitError extends DomainError {
  public readonly retryAfter: number;

  constructor(retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${retryAfter}s`, "RATE_LIMITED", 429);
    this.retryAfter = retryAfter;
  }
}

export class ConfigurationError extends DomainError {
  constructor(message: string) {
    super(message, "CONFIGURATION_ERROR", 500);
  }
}

export class InfrastructureError extends DomainError {
  public readonly cause?: Error;

  constructor(message: string, cause?: Error) {
    super(message, "INFRASTRUCTURE_ERROR", 502);
    this.cause = cause;
  }
}

export class AgentExecutionError extends DomainError {
  public readonly agentId: string;
  public readonly taskId?: string;

  constructor(message: string, agentId: string, taskId?: string) {
    super(message, "AGENT_EXECUTION_ERROR", 500);
    this.agentId = agentId;
    this.taskId = taskId;
  }
}
