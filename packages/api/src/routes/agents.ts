/**
 * Agent management API routes.
 */

import { Hono } from "hono";

export function createAgentRoutes(): Hono {
  const app = new Hono();

  // List registered agents
  app.get("/", (ctx) => {
    // TODO: Wire to AgentOrchestrator
    return ctx.json({ agents: [] });
  });

  // Get agent details
  app.get("/:id", (ctx) => {
    const id = ctx.req.param("id");
    // TODO: Wire to AgentOrchestrator
    return ctx.json({ agent: { id, status: "unknown" } });
  });

  // Delegate task to agent
  app.post("/:id/tasks", async (ctx) => {
    const id = ctx.req.param("id");
    const body = await ctx.req.json();
    // TODO: Wire to AgentOrchestrator.delegate()
    return ctx.json(
      {
        taskId: crypto.randomUUID(),
        agentId: id,
        status: "queued",
        task: body,
      },
      202
    );
  });

  return app;
}
