import { describe, it, expect } from "vitest";
import { createHealthRoutes } from "../../packages/api/src/routes/health.js";

describe("Health Routes", () => {
  const app = createHealthRoutes();

  it("GET /health should return ok status", async () => {
    const res = await app.request("/health");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.version).toBe("2.0.0-alpha.1");
    expect(body.timestamp).toBeDefined();
    expect(typeof body.uptime).toBe("number");
  });

  it("GET /ready should return readiness status", async () => {
    const res = await app.request("/ready");
    expect(res.status).toBe(200);

    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ready");
    expect(body.checks).toBeDefined();
  });
});
