/**
 * Main API server.
 * Assembles all routes and middleware.
 */

import { Hono } from "hono";
import { createAdaptorServer } from "@hono/node-server";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import { createHealthRoutes } from "./routes/health.js";
import { createAgentRoutes } from "./routes/agents.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createDocsRoutes } from "./routes/docs.js";
import {
  createRateLimitMiddleware,
  createBodySizeLimitMiddleware,
  createAuthRateLimitMiddleware,
  securityHeadersMiddleware,
  requestIdMiddleware,
  type SecurityConfig,
  type AuthRateLimitConfig,
} from "./middleware/security.middleware.js";
import { createAuthMiddleware, type AuthConfig } from "./middleware/auth.middleware.js";
import { createCsrfMiddleware, type CsrfConfig } from "./middleware/csrf.middleware.js";
import { errorHandler } from "./middleware/error-handler.js";

export interface TlsConfig {
  keyPath: string;
  certPath: string;
  /** Optional HTTP port that redirects all traffic to HTTPS (e.g. 80). */
  httpRedirectPort?: number;
}

export interface ServerConfig {
  port: number;
  host: string;
  auth: AuthConfig;
  security: SecurityConfig;
  csrf?: CsrfConfig;
  authRateLimit?: AuthRateLimitConfig;
  tls?: TlsConfig;
}

/**
 * Warn when the API is exposed on a non-loopback address without TLS.
 * Loopback addresses (127.x.x.x, ::1, localhost) are safe without TLS.
 */
export function warnIfInsecure(config: Pick<ServerConfig, "host" | "tls">): void {
  const loopback = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;
  if (!config.tls && !loopback.test(config.host)) {
    console.warn(
      // eslint-disable-line no-console
      "⚠️  WARNING: API server is listening on a non-loopback address without TLS. " +
        "Credentials (JWT tokens, API keys) will be transmitted in plaintext. " +
        "Set api.tls in your configuration to enable HTTPS."
    );
  }
}

/**
 * Start the Node.js HTTP/HTTPS server with the given Hono app.
 * Returns a Promise that resolves when the server is listening.
 *
 * When TLS is configured:
 *  - Starts an HTTPS server on config.port.
 *  - Optionally starts an HTTP server on config.tls.httpRedirectPort that
 *    issues 301 redirects to the HTTPS address.
 *
 * When TLS is NOT configured:
 *  - Starts a plain HTTP server on config.port.
 */
export async function startServer(
  app: Hono,
  config: ServerConfig
): Promise<{ port: number; secure: boolean }> {
  warnIfInsecure(config);

  if (config.tls) {
    const serverOptions = {
      key: readFileSync(config.tls.keyPath),
      cert: readFileSync(config.tls.certPath),
    };

    await new Promise<void>((resolve) => {
      createAdaptorServer({
        fetch: app.fetch,
        serverOptions,
        createServer: createHttpsServer,
      }).listen(config.port, config.host, () => {
        console.log(`✅ HTTPS server listening on https://${config.host}:${config.port}`); // eslint-disable-line no-console
        resolve();
      });
    });

    if (config.tls.httpRedirectPort !== undefined) {
      const redirectPort = config.tls.httpRedirectPort;
      const httpsPort = config.port;
      await new Promise<void>((resolve) => {
        createHttpServer((req, res) => {
          const host = (req.headers.host ?? "localhost").split(":")[0];
          const location = `https://${host}${httpsPort !== 443 ? `:${httpsPort}` : ""}${req.url ?? "/"}`;
          res.writeHead(301, { Location: location });
          res.end();
        }).listen(redirectPort, config.host, () => {
          console.log(
            // eslint-disable-line no-console
            `✅ HTTP→HTTPS redirect server listening on http://${config.host}:${redirectPort}`
          );
          resolve();
        });
      });
    }

    return { port: config.port, secure: true };
  }

  await new Promise<void>((resolve) => {
    createAdaptorServer({ fetch: app.fetch }).listen(config.port, config.host, () => {
      console.log(`✅ HTTP server listening on http://${config.host}:${config.port}`); // eslint-disable-line no-console
      resolve();
    });
  });

  return { port: config.port, secure: false };
}

export function createServer(config: ServerConfig): Hono {
  const app = new Hono();

  // Global middleware
  app.use("*", requestIdMiddleware());
  app.use("*", securityHeadersMiddleware());
  app.use("*", createBodySizeLimitMiddleware(config.security));
  app.use("*", createRateLimitMiddleware(config.security));
  // Apply stricter rate limiting to auth endpoints before the auth middleware
  // to prevent brute-force attacks and credential stuffing.
  app.use("/api/auth/*", createAuthRateLimitMiddleware(config.authRateLimit));
  app.use("/api/*", createAuthMiddleware(config.auth));
  app.use("/api/*", createCsrfMiddleware(config.csrf));

  // Error handler
  app.onError(errorHandler);

  // Routes
  app.route("/", createHealthRoutes());
  app.route("/api/auth", createAuthRoutes(config.auth, config.csrf));
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
