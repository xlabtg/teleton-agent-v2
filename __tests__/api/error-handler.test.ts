import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { ValidationError } from "../../packages/core/src/errors/domain-errors.js";
import { errorHandler } from "../../packages/api/src/middleware/error-handler.js";

describe("errorHandler", () => {
  it("should include ValidationError details in the error response", async () => {
    const details = {
      email: ["Invalid email address"],
      password: ["Must be at least 8 characters"],
    };

    const app = new Hono();
    app.onError(errorHandler);
    app.post("/users", () => {
      throw new ValidationError("Invalid user payload", details);
    });

    const res = await app.request("/users", { method: "POST" });

    expect(res.status).toBe(400);
    const body = (await res.json()) as {
      error: { code: string; message: string; details?: unknown };
    };
    expect(body.error).toEqual({
      code: "VALIDATION_ERROR",
      message: "Invalid user payload",
      details,
    });
  });
});
