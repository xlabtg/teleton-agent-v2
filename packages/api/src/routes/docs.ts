/**
 * API documentation route.
 * Serves an OpenAPI 3.0 spec and a Swagger UI page at /api/docs.
 * This route must be registered BEFORE auth middleware so it is publicly accessible.
 */

import { Hono } from "hono";

/** OpenAPI 3.0 specification describing all public API endpoints. */
const openApiSpec = {
  openapi: "3.0.3",
  info: {
    title: "Teleton Agent V2 API",
    version: "2.0.0-alpha.2",
    description:
      "REST API for the Teleton autonomous AI agent platform. Provides authentication, agent management, and health endpoints.",
  },
  servers: [{ url: "/", description: "Current server" }],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: "http",
        scheme: "bearer",
        bearerFormat: "JWT",
      },
    },
    schemas: {
      Error: {
        type: "object",
        properties: {
          error: {
            type: "object",
            properties: {
              code: { type: "string" },
              message: { type: "string" },
            },
            required: ["code", "message"],
          },
        },
      },
      TokenResponse: {
        type: "object",
        properties: {
          token: { type: "string" },
          refreshToken: { type: "string" },
          expiresIn: { type: "number" },
          tokenType: { type: "string", example: "Bearer" },
        },
        required: ["token", "refreshToken", "expiresIn", "tokenType"],
      },
      UserInfo: {
        type: "object",
        properties: {
          user: {
            type: "object",
            properties: {
              sub: { type: "string", description: "Subject (username)" },
              role: { type: "string", enum: ["admin", "user", "plugin", "readonly"] },
              iat: { type: "number", description: "Issued at (Unix timestamp)" },
              exp: { type: "number", description: "Expires at (Unix timestamp)" },
            },
            required: ["sub", "role", "iat", "exp"],
          },
        },
      },
    },
  },
  paths: {
    "/health": {
      get: {
        summary: "Health check",
        description: "Returns service health status. No authentication required.",
        tags: ["Health"],
        responses: {
          "200": {
            description: "Service is healthy",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ok" },
                    version: { type: "string" },
                    timestamp: { type: "string" },
                    uptime: { type: "number" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/ready": {
      get: {
        summary: "Readiness check",
        description: "Returns service readiness status. No authentication required.",
        tags: ["Health"],
        responses: {
          "200": {
            description: "Service is ready",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    status: { type: "string", example: "ready" },
                    checks: { type: "object" },
                  },
                },
              },
            },
          },
        },
      },
    },
    "/api/auth/login": {
      post: {
        summary: "Login",
        description: "Authenticate with username and password to obtain a Bearer token.",
        tags: ["Authentication"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  username: { type: "string" },
                  password: { type: "string" },
                },
                required: ["username", "password"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Login successful",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/TokenResponse" } },
            },
          },
          "400": {
            description: "Missing credentials",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/auth/refresh": {
      post: {
        summary: "Refresh token",
        description: "Exchange a refresh token for a new access token.",
        tags: ["Authentication"],
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                properties: {
                  refreshToken: { type: "string" },
                },
                required: ["refreshToken"],
              },
            },
          },
        },
        responses: {
          "200": {
            description: "Token refreshed",
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    token: { type: "string" },
                    expiresIn: { type: "number" },
                    tokenType: { type: "string" },
                  },
                },
              },
            },
          },
          "400": {
            description: "Missing refresh token",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
          "401": {
            description: "Invalid or expired refresh token",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/auth/me": {
      get: {
        summary: "Get current user",
        description: "Returns the authenticated user's info from the Bearer token.",
        tags: ["Authentication"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": {
            description: "Current user info",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/UserInfo" } },
            },
          },
          "401": {
            description: "Missing, invalid, or expired token",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
    "/api/agents": {
      get: {
        summary: "List agents",
        description: "Returns a list of registered agents.",
        tags: ["Agents"],
        security: [{ bearerAuth: [] }],
        responses: {
          "200": { description: "List of agents" },
          "401": {
            description: "Unauthorized",
            content: {
              "application/json": { schema: { $ref: "#/components/schemas/Error" } },
            },
          },
        },
      },
    },
  },
};

/** Swagger UI HTML (uses CDN assets and a same-origin bootstrap script). */
function buildSwaggerHtml(initScriptUrl: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Teleton Agent V2 — API Docs</title>
  <link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script src="${initScriptUrl}"></script>
</body>
</html>`;
}

function buildSwaggerInitializer(specUrl: string): string {
  return `SwaggerUIBundle({
  url: ${JSON.stringify(specUrl)},
  dom_id: "#swagger-ui",
  presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
  layout: "BaseLayout",
  deepLinking: true,
});
`;
}

export function createDocsRoutes(): Hono {
  const app = new Hono();

  /** GET /api/docs — Swagger UI (publicly accessible) */
  app.get("/", (ctx) => {
    return ctx.html(buildSwaggerHtml("/api/docs/swagger-init.js"));
  });

  /** GET /api/docs/openapi.json — Raw OpenAPI spec (publicly accessible) */
  app.get("/openapi.json", (ctx) => {
    return ctx.json(openApiSpec);
  });

  /** GET /api/docs/swagger-init.js — Same-origin Swagger UI bootstrap script */
  app.get("/swagger-init.js", (ctx) => {
    ctx.header("Content-Type", "application/javascript; charset=utf-8");
    return ctx.body(buildSwaggerInitializer("/api/docs/openapi.json"));
  });

  return app;
}
