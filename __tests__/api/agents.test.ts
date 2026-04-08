/**
 * Agent routes input validation tests.
 * Verifies that the POST /:id/tasks endpoint correctly validates inputs
 * and that the GET /:id endpoint validates agent IDs.
 */
import { describe, it, expect } from "vitest";
import { createAgentRoutes } from "../../packages/api/src/routes/agents.js";
import { Hono } from "hono";
import { errorHandler } from "../../packages/api/src/middleware/error-handler.js";

function buildApp() {
  const app = new Hono();
  app.onError(errorHandler);
  app.route("/api/agents", createAgentRoutes());
  return app;
}

describe("Agent Routes", () => {
  const app = buildApp();

  describe("GET /api/agents", () => {
    it("should return empty agents list", async () => {
      const res = await app.request("/api/agents");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(Array.isArray(body.agents)).toBe(true);
    });
  });

  describe("GET /api/agents/:id", () => {
    it("should return agent details for valid ID", async () => {
      const res = await app.request("/api/agents/agent-123");
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect((body.agent as Record<string, unknown>).id).toBe("agent-123");
    });

    it("should reject IDs with special characters", async () => {
      // ID with special chars in segment (null byte URL-encoded):
      const res = await app.request("/api/agents/agent%00evil");
      expect([400, 404, 422]).toContain(res.status);
    });
  });

  describe("POST /api/agents/:id/tasks — input validation", () => {
    it("should accept a valid task payload", async () => {
      const res = await app.request("/api/agents/agent-1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          description: "Do something useful",
          inputs: { key: "value" },
          priority: "high",
        }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.agentId).toBe("agent-1");
      expect(body.status).toBe("queued");
      expect(typeof body.taskId).toBe("string");
    });

    it("should accept an empty payload (all fields optional)", async () => {
      const res = await app.request("/api/agents/agent-1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      expect(res.status).toBe(202);
    });

    it("should reject description longer than 1000 characters", async () => {
      const res = await app.request("/api/agents/agent-1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "x".repeat(1001) }),
      });
      expect(res.status).toBe(400);
    });

    it("should reject inputs payload larger than 10 KB", async () => {
      const largeInputs: Record<string, string> = {};
      for (let i = 0; i < 500; i++) {
        largeInputs[`key_${i}`] = "x".repeat(30);
      }
      const res = await app.request("/api/agents/agent-1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inputs: largeInputs }),
      });
      expect(res.status).toBe(400);
    });

    it("should reject an invalid priority value", async () => {
      const res = await app.request("/api/agents/agent-1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ priority: "critical" }),
      });
      expect(res.status).toBe(400);
    });

    it("should reject malformed JSON body", async () => {
      const res = await app.request("/api/agents/agent-1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json {{",
      });
      expect(res.status).toBe(400);
    });

    it("should apply default priority 'medium' when not provided", async () => {
      const res = await app.request("/api/agents/agent-1/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ description: "Test task" }),
      });
      expect(res.status).toBe(202);
      const body = (await res.json()) as { task: { priority: string } };
      expect(body.task.priority).toBe("medium");
    });
  });
});
