/**
 * Agent management API routes.
 */

import { Hono } from "hono";
import { z } from "zod";
import { ValidationError } from "@teleton/core/errors/domain-errors.js";

const AgentIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[\w-]+$/, "Agent ID must be alphanumeric");

const CreateTaskSchema = z.object({
  description: z.string().max(1000).optional(),
  inputs: z
    .record(z.unknown())
    .refine((v) => JSON.stringify(v).length <= 10_000, { message: "Inputs too large (max 10 KB)" })
    .optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
});

export function createAgentRoutes(): Hono {
  const app = new Hono();

  // List registered agents
  app.get("/", (ctx) => {
    // TODO: Wire to AgentOrchestrator
    return ctx.json({ agents: [] });
  });

  // Get agent details
  app.get("/:id", (ctx) => {
    const idResult = AgentIdSchema.safeParse(ctx.req.param("id"));
    if (!idResult.success) {
      throw new ValidationError("Invalid agent ID", { id: idResult.error.flatten().formErrors });
    }
    // TODO: Wire to AgentOrchestrator
    return ctx.json({ agent: { id: idResult.data, status: "unknown" } });
  });

  // Delegate task to agent
  app.post("/:id/tasks", async (ctx) => {
    const idResult = AgentIdSchema.safeParse(ctx.req.param("id"));
    if (!idResult.success) {
      throw new ValidationError("Invalid agent ID", { id: idResult.error.flatten().formErrors });
    }

    let rawBody: unknown;
    try {
      rawBody = await ctx.req.json();
    } catch {
      throw new ValidationError("Request body must be valid JSON", {});
    }

    const bodyResult = CreateTaskSchema.safeParse(rawBody);
    if (!bodyResult.success) {
      throw new ValidationError("Invalid task payload", bodyResult.error.flatten().fieldErrors);
    }

    // TODO: Wire to AgentOrchestrator.delegate()
    return ctx.json(
      {
        taskId: crypto.randomUUID(),
        agentId: idResult.data,
        status: "queued",
        task: bodyResult.data,
      },
      202
    );
  });

  return app;
}
