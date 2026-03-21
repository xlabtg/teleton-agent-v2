/**
 * Global error handler middleware.
 * Converts domain errors to proper HTTP responses.
 */

import type { Context } from "hono";
import { DomainError } from "@teleton/core/errors/domain-errors.js";

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: unknown;
  };
  requestId?: string;
}

export function errorHandler(err: Error, ctx: Context): Response {
  const requestId = ctx.get("requestId") as string | undefined;

  if (err instanceof DomainError) {
    const body: ErrorResponse = {
      error: {
        code: err.code,
        message: err.message,
      },
      requestId,
    };

    return ctx.json(body, err.statusCode as 400 | 401 | 403 | 404 | 429 | 500);
  }

  // Unknown error — don't expose internals
  console.error("Unhandled error:", err);

  const body: ErrorResponse = {
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
    },
    requestId,
  };

  return ctx.json(body, 500);
}
