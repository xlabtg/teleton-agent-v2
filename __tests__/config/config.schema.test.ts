import { describe, expect, it } from "vitest";
import { appConfigSchema, JWT_SECRET_MIN_LENGTH } from "../../configs/config.schema.js";

const BASE_CONFIG = {
  telegram: {
    api_id: 1,
    api_hash: "test-api-hash",
  },
};

describe("appConfigSchema security config", () => {
  it("rejects JWT signing secrets shorter than the minimum length", () => {
    const result = appConfigSchema.safeParse({
      ...BASE_CONFIG,
      security: {
        jwt_secret: "secret",
      },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            path: ["security", "jwt_secret"],
            message: expect.stringContaining(`${JWT_SECRET_MIN_LENGTH} characters`),
          }),
        ])
      );
    }
  });

  it("accepts JWT signing secrets at the minimum length", () => {
    const result = appConfigSchema.safeParse({
      ...BASE_CONFIG,
      security: {
        jwt_secret: "a".repeat(JWT_SECRET_MIN_LENGTH),
      },
    });

    expect(result.success).toBe(true);
  });

  it("allows omitting JWT signing secret so the app can apply environment-specific policy", () => {
    const result = appConfigSchema.safeParse(BASE_CONFIG);

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.security.jwt_secret).toBeUndefined();
    }
  });
});
