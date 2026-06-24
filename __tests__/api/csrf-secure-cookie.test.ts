import { afterEach, describe, expect, it } from "vitest";
import {
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
} from "../../packages/api/src/middleware/csrf.middleware.js";
import { createServer, type ServerConfig } from "../../packages/api/src/server.js";

const ORIGINAL_NODE_ENV = process.env.NODE_ENV;

const TEST_PASSWORD_HASH =
  "scrypt$16384$8$1$64$dGVzdC11c2VyLXNhbHQtdjE$Dt11kfNFhBIumZljaSG_p8M0sf7RN1oaAgHDuejOXH5dcO_IZOclLQCFwyJafBNKE42PBBJ__ip8GlEjRXtc3Q";

const BASE_SERVER_CONFIG: ServerConfig = {
  port: 0,
  host: "127.0.0.1",
  auth: {
    jwtSecret: "test-secret-key",
    tokenExpiry: 3600,
    refreshTokenExpiry: 604800,
    userStore: {
      findByUsername(username: string) {
        if (username !== "admin") {
          return null;
        }

        return {
          username,
          role: "admin" as const,
          passwordHash: TEST_PASSWORD_HASH,
        };
      },
    },
  },
  security: {
    rateLimitWindow: 60_000,
    rateLimitMax: 100,
    corsOrigins: ["http://localhost:5173"],
  },
};

function restoreNodeEnv(): void {
  if (ORIGINAL_NODE_ENV === undefined) {
    delete process.env.NODE_ENV;
    return;
  }

  process.env.NODE_ENV = ORIGINAL_NODE_ENV;
}

function createTlsServerConfig(): ServerConfig {
  return {
    ...BASE_SERVER_CONFIG,
    tls: {
      keyPath: "/tmp/test-key.pem",
      certPath: "/tmp/test-cert.pem",
    },
  };
}

async function getBearerToken(app: ReturnType<typeof createServer>): Promise<string> {
  const res = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "correct-password" }),
  });
  const body = (await res.json()) as Record<string, string>;
  return body.token;
}

afterEach(() => {
  restoreNodeEnv();
});

describe("CSRF Secure cookie derivation", () => {
  it("sets Secure on the CSRF token cookie when TLS is configured", async () => {
    const app = createServer(createTlsServerConfig());

    const res = await app.request("/api/auth/csrf-token");
    const setCookie = res.headers.get("Set-Cookie") ?? "";

    expect(setCookie).toContain(`${CSRF_COOKIE_NAME}=`);
    expect(setCookie).toContain("; Secure");
  });

  it("sets Secure on the CSRF token cookie in production", async () => {
    process.env.NODE_ENV = "production";
    const app = createServer(BASE_SERVER_CONFIG);

    const res = await app.request("/api/auth/csrf-token");
    const setCookie = res.headers.get("Set-Cookie") ?? "";

    expect(setCookie).toContain(`${CSRF_COOKIE_NAME}=`);
    expect(setCookie).toContain("; Secure");
  });

  it("uses the same Secure CSRF config when refreshing the cookie after mutations", async () => {
    const app = createServer(createTlsServerConfig());
    const authToken = await getBearerToken(app);

    const csrfRes = await app.request("/api/auth/csrf-token");
    const { csrfToken } = (await csrfRes.json()) as Record<string, string>;

    const mutationRes = await app.request("/api/agents/agent-1/tasks", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${authToken}`,
        "Content-Type": "application/json",
        Cookie: `${CSRF_COOKIE_NAME}=${csrfToken}`,
        [CSRF_HEADER_NAME]: csrfToken,
      },
      body: JSON.stringify({ description: "test" }),
    });
    const setCookie = mutationRes.headers.get("Set-Cookie") ?? "";

    expect(mutationRes.status).toBe(202);
    expect(setCookie).toContain(`${CSRF_COOKIE_NAME}=`);
    expect(setCookie).toContain("; Secure");
  });
});
