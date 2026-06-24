/**
 * Main API server.
 * Assembles all routes and middleware.
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { createAdaptorServer } from "@hono/node-server";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createHealthRoutes } from "./routes/health.js";
import { createAgentRoutes } from "./routes/agents.js";
import { createAuthRoutes } from "./routes/auth.js";
import { createDocsRoutes } from "./routes/docs.js";
import {
  createRateLimitMiddleware,
  createBodySizeLimitMiddleware,
  createAuthRateLimitMiddleware,
  createCorsConfig,
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

export function deriveCsrfConfig(
  config: Pick<ServerConfig, "csrf" | "tls">,
  runtimeEnv = process.env.NODE_ENV
): CsrfConfig {
  const secureCookie =
    Boolean(config.csrf?.secureCookie) || Boolean(config.tls) || runtimeEnv === "production";

  return {
    ...(config.csrf ?? {}),
    secureCookie,
  };
}

interface ListeningServer {
  listen(port: number, host: string, callback: () => void): unknown;
  once(event: "error", listener: (error: Error) => void): this;
  off(event: "error", listener: (error: Error) => void): this;
  close(callback?: (error?: Error) => void): this;
  address(): AddressInfo | string | null;
  readonly listening: boolean;
}

export interface ServerHandle {
  port: number;
  secure: boolean;
  close(): Promise<void>;
}

/**
 * Warn when the API is exposed on a non-loopback address without TLS.
 * Loopback addresses (127.x.x.x, ::1, localhost) are safe without TLS.
 */
export function warnIfInsecure(config: Pick<ServerConfig, "host" | "tls">): void {
  const loopback = /^(127\.\d+\.\d+\.\d+|::1|localhost)$/;
  if (!config.tls && !loopback.test(config.host)) {
    console.warn(
      "⚠️  WARNING: API server is listening on a non-loopback address without TLS. " +
        "Credentials (JWT tokens, API keys) will be transmitted in plaintext. " +
        "Set api.tls in your configuration to enable HTTPS."
    );
  }
}

function listenServer(
  server: ListeningServer,
  port: number,
  host: string,
  onListening: () => void
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("error", onError);
      reject(error);
    };

    server.once("error", onError);

    try {
      server.listen(port, host, () => {
        server.off("error", onError);
        try {
          onListening();
          resolve();
        } catch (error) {
          reject(error);
        }
      });
    } catch (error) {
      server.off("error", onError);
      reject(error);
    }
  });
}

function getListeningPort(server: ListeningServer, fallbackPort: number): number {
  const address = server.address();
  return typeof address === "object" && address !== null ? address.port : fallbackPort;
}

function closeServer(server: ListeningServer): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }

  return new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });
}

function createServerHandle(
  port: number,
  secure: boolean,
  servers: ListeningServer[]
): ServerHandle {
  let closed = false;

  return {
    port,
    secure,
    async close() {
      if (closed) {
        return;
      }

      closed = true;
      const results = await Promise.allSettled(servers.map(closeServer));
      const failures = results.filter((result) => result.status === "rejected");

      if (failures.length > 0) {
        throw new AggregateError(
          failures.map((failure) => failure.reason),
          "Failed to close API server"
        );
      }
    },
  };
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
export async function startServer(app: Hono, config: ServerConfig): Promise<ServerHandle> {
  warnIfInsecure(config);

  if (config.tls) {
    const serverOptions = {
      key: readFileSync(config.tls.keyPath),
      cert: readFileSync(config.tls.certPath),
    };

    const httpsServer = createAdaptorServer({
      fetch: app.fetch,
      serverOptions,
      createServer: createHttpsServer,
    });
    await listenServer(httpsServer, config.port, config.host, () => {
      console.log(`✅ HTTPS server listening on https://${config.host}:${config.port}`); // eslint-disable-line no-console
    });

    const servers: ListeningServer[] = [httpsServer];
    const port = getListeningPort(httpsServer, config.port);

    if (config.tls.httpRedirectPort !== undefined) {
      const redirectPort = config.tls.httpRedirectPort;
      const httpsPort = config.port;
      const redirectServer = createHttpServer((req, res) => {
        const host = (req.headers.host ?? "localhost").split(":")[0];
        const location = `https://${host}${httpsPort !== 443 ? `:${httpsPort}` : ""}${req.url ?? "/"}`;
        res.writeHead(301, { Location: location });
        res.end();
      });
      try {
        await listenServer(redirectServer, redirectPort, config.host, () => {
          console.log(
            `✅ HTTP→HTTPS redirect server listening on http://${config.host}:${redirectPort}`
          );
        });
      } catch (error) {
        await closeServer(httpsServer).catch(() => {});
        throw error;
      }
      servers.push(redirectServer);
    }

    return createServerHandle(port, true, servers);
  }

  const httpServer = createAdaptorServer({ fetch: app.fetch });
  await listenServer(httpServer, config.port, config.host, () => {
    console.log(`✅ HTTP server listening on http://${config.host}:${config.port}`); // eslint-disable-line no-console
  });

  return createServerHandle(getListeningPort(httpServer, config.port), false, [httpServer]);
}

export function createServer(config: ServerConfig): Hono {
  const app = new Hono();
  const csrfConfig = deriveCsrfConfig(config);

  // Global middleware
  app.use("*", requestIdMiddleware());
  app.use("*", securityHeadersMiddleware());
  app.use("*", cors(createCorsConfig(config.security.corsOrigins)));
  app.use("*", createBodySizeLimitMiddleware(config.security));
  app.use("*", createRateLimitMiddleware(config.security));
  // Apply stricter rate limiting to auth endpoints before the auth middleware
  // to prevent brute-force attacks and credential stuffing.
  app.use("/api/auth/*", createAuthRateLimitMiddleware(config.authRateLimit));
  app.use("/api/*", createAuthMiddleware(config.auth));
  app.use("/api/*", createCsrfMiddleware(csrfConfig));

  // Error handler
  app.onError(errorHandler);

  // Routes
  app.route("/", createHealthRoutes());
  app.route("/api/auth", createAuthRoutes(config.auth, csrfConfig));
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
