/**
 * Main API server.
 * Assembles all routes and middleware.
 */

import { Hono } from "hono";
import { createHealthRoutes } from "./routes/health.js";
import { createAgentRoutes } from "./routes/agents.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createDocsRoutes } from "./routes/docs.js";
import {
  createRateLimitMiddleware,
  createBodySizeLimitMiddleware,
  securityHeadersMiddleware,
  requestIdMiddleware,
  type SecurityConfig,
} from "./middleware/security.middleware.js";
import { createAuthMiddleware, type AuthConfig } from "./middleware/auth.middleware.js";
import { errorHandler } from "./middleware/error-handler.js";

export interface ServerConfig {
  port: number;
  host: string;
  auth: AuthConfig;
  security: SecurityConfig;
}

export function createServer(config: ServerConfig): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", requestIdMiddleware());
  app.use("*", securityHeadersMiddleware());
  app.use("*", createBodySizeLimitMiddleware(config.security));
  app.use("*", createRateLimitMiddleware(config.security));
  app.use("/api/*", createAuthMiddleware(config.auth));

  // Error handler
  app.onError(errorHandler);

  // Routes
  app.route("/", createHealthRoutes());
  app.route("/api/auth", createAuthRoutes(config.auth));
  app.route("/api/docs", createDocsRoutes());
  app.route("/api/agents", createAgentRoutes());

  // Root
  app.get("/", (ctx) => {
    return ctx.json({
      name: "teleton-agent-v2",
      version: "2.0.0-alpha.2",
      docs: "/api/docs",
    });
  });

  return app;
}
