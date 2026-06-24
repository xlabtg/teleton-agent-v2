import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { ValidationError } from "../../packages/core/src/errors/domain-errors.js";
import { errorHandler } from "../../packages/api/src/middleware/error-handler.js";
import { requestIdMiddleware } from "../../packages/api/src/middleware/security.middleware.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function createRequestIdTestApp(): Hono {
  const app = new Hono();
  app.use("*", requestIdMiddleware());
  app.onError(errorHandler);
  app.get("/error", () => {
    throw new ValidationError("Invalid payload", { field: ["required"] });
  });

  return app;
}

async function requestErrorWithId(requestId: string): Promise<{
  responseRequestId: string | null;
  bodyRequestId: string | undefined;
}> {
  const app = createRequestIdTestApp();
  const res = await app.request("/error", {
    headers: { "X-Request-Id": requestId },
  });
  const body = (await res.json()) as { requestId?: string };

  return {
    responseRequestId: res.headers.get("X-Request-Id"),
    bodyRequestId: body.requestId,
  };
}

async function runMiddlewareWithRawRequestId(requestId: string): Promise<{
  contextRequestId: unknown;
  responseRequestId: string | undefined;
  nextCalled: boolean;
}> {
  let contextRequestId: unknown;
  let responseRequestId: string | undefined;
  let nextCalled = false;
  const ctx = {
    req: {
      header: (name: string) => (name.toLowerCase() === "x-request-id" ? requestId : undefined),
    },
    set: (key: string, value: unknown) => {
      if (key === "requestId") {
        contextRequestId = value;
      }
    },
    header: (key: string, value: string) => {
      if (key === "X-Request-Id") {
        responseRequestId = value;
      }
    },
  } as unknown as Context;
  const next: Next = async () => {
    nextCalled = true;
  };

  await requestIdMiddleware()(ctx, next);

  return {
    contextRequestId,
    responseRequestId,
    nextCalled,
  };
}

describe("requestIdMiddleware", () => {
  it("propagates a valid client-provided request id", async () => {
    const requestId = "api.request_123-456";
    const { responseRequestId, bodyRequestId } = await requestErrorWithId(requestId);

    expect(responseRequestId).toBe(requestId);
    expect(bodyRequestId).toBe(requestId);
  });

  it("replaces a request id containing newlines with a generated UUID", async () => {
    const maliciousRequestId = "valid-prefix\nforged-log-line";
    const { contextRequestId, responseRequestId, nextCalled } =
      await runMiddlewareWithRawRequestId(maliciousRequestId);

    expect(responseRequestId).not.toBe(maliciousRequestId);
    expect(contextRequestId).not.toBe(maliciousRequestId);
    expect(responseRequestId).toMatch(UUID_PATTERN);
    expect(contextRequestId).toBe(responseRequestId);
    expect(nextCalled).toBe(true);
  });

  it("replaces an over-length request id with a generated UUID", async () => {
    const overLengthRequestId = "a".repeat(129);
    const { responseRequestId, bodyRequestId } = await requestErrorWithId(overLengthRequestId);

    expect(responseRequestId).not.toBe(overLengthRequestId);
    expect(bodyRequestId).not.toBe(overLengthRequestId);
    expect(responseRequestId).toMatch(UUID_PATTERN);
    expect(bodyRequestId).toBe(responseRequestId);
  });
});
