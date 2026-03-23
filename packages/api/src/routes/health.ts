/**
 * Health check endpoint.
 * Used by Docker HEALTHCHECK and load balancers.
 */

import { Hono } from "hono";

export function createHealthRoutes(): Hono {
  const app = new Hono();

  app.get("/health", (ctx) => {
    return ctx.json({
      status: "ok",
      version: "2.0.0-alpha.2",
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get("/ready", (ctx) => {
    // TODO: Check actual service readiness (DB, Telegram connection, etc.)
    return ctx.json({
      status: "ready",
      checks: {
        database: "ok",
        telegram: "ok",
      },
    });
  });

  return app;
}
