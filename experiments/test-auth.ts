import { createServer } from "../packages/api/src/server.js";

async function main() {
  const app = createServer({
    port: 3001,
    host: "127.0.0.1",
    auth: {
      jwtSecret: "test-secret",
      tokenExpiry: 3600,
      refreshTokenExpiry: 604800,
    },
    security: {
      rateLimitWindow: 900000,
      rateLimitMax: 100,
      corsOrigins: [],
    },
  });

  const loginRes = await app.request("/api/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "test" }),
  });

  console.log("Login status:", loginRes.status);
  const loginBody = (await loginRes.json()) as Record<string, unknown>;
  console.log("Login body:", JSON.stringify(loginBody, null, 2));

  const healthRes = await app.request("/health");
  console.log("Health status:", healthRes.status);

  const agentsRes = await app.request("/api/agents");
  console.log("Agents status (no token):", agentsRes.status);

  const token = loginBody.token as string;
  const agentsWithTokenRes = await app.request("/api/agents", {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("Agents status (with token):", agentsWithTokenRes.status);
}

main().catch(console.error);
