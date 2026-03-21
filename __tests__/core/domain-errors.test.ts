import { describe, it, expect } from "vitest";
import {
  DomainError,
  NotFoundError,
  ValidationError,
  AuthenticationError,
  ForbiddenError,
  RateLimitError,
  ConfigurationError,
  InfrastructureError,
  AgentExecutionError,
} from "../../packages/core/src/errors/domain-errors.js";

describe("Domain Errors", () => {
  describe("DomainError", () => {
    it("should create error with code and status", () => {
      const error = new DomainError("test error", "TEST", 418);
      expect(error.message).toBe("test error");
      expect(error.code).toBe("TEST");
      expect(error.statusCode).toBe(418);
      expect(error.name).toBe("DomainError");
      expect(error).toBeInstanceOf(Error);
    });

    it("should default to 500 status code", () => {
      const error = new DomainError("test", "TEST");
      expect(error.statusCode).toBe(500);
    });
  });

  describe("NotFoundError", () => {
    it("should format entity not found message", () => {
      const error = new NotFoundError("Agent", "abc-123");
      expect(error.message).toBe("Agent with id 'abc-123' not found");
      expect(error.code).toBe("NOT_FOUND");
      expect(error.statusCode).toBe(404);
    });
  });

  describe("ValidationError", () => {
    it("should include validation details", () => {
      const details = { name: ["required"], age: ["must be positive"] };
      const error = new ValidationError("Invalid input", details);
      expect(error.message).toBe("Invalid input");
      expect(error.code).toBe("VALIDATION_ERROR");
      expect(error.statusCode).toBe(400);
      expect(error.details).toEqual(details);
    });
  });

  describe("AuthenticationError", () => {
    it("should have default message", () => {
      const error = new AuthenticationError();
      expect(error.message).toBe("Authentication required");
      expect(error.statusCode).toBe(401);
    });

    it("should accept custom message", () => {
      const error = new AuthenticationError("Token expired");
      expect(error.message).toBe("Token expired");
    });
  });

  describe("ForbiddenError", () => {
    it("should have default message", () => {
      const error = new ForbiddenError();
      expect(error.message).toBe("Insufficient permissions");
      expect(error.statusCode).toBe(403);
    });
  });

  describe("RateLimitError", () => {
    it("should include retry-after", () => {
      const error = new RateLimitError(60);
      expect(error.message).toContain("60s");
      expect(error.statusCode).toBe(429);
      expect(error.retryAfter).toBe(60);
    });
  });

  describe("ConfigurationError", () => {
    it("should have 500 status", () => {
      const error = new ConfigurationError("Missing API key");
      expect(error.statusCode).toBe(500);
      expect(error.code).toBe("CONFIGURATION_ERROR");
    });
  });

  describe("InfrastructureError", () => {
    it("should wrap cause error", () => {
      const cause = new Error("connection refused");
      const error = new InfrastructureError("Database unavailable", cause);
      expect(error.statusCode).toBe(502);
      expect(error.cause).toBe(cause);
    });
  });

  describe("AgentExecutionError", () => {
    it("should include agent and task IDs", () => {
      const error = new AgentExecutionError("Timeout", "agent-1", "task-99");
      expect(error.agentId).toBe("agent-1");
      expect(error.taskId).toBe("task-99");
      expect(error.statusCode).toBe(500);
    });
  });
});
