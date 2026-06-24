import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EnvSecretsAdapter } from "../../packages/infrastructure/src/secrets/env.adapter.js";

describe("EnvSecretsAdapter", () => {
  let adapter: EnvSecretsAdapter;

  beforeEach(() => {
    adapter = new EnvSecretsAdapter("TEST_");
  });

  afterEach(() => {
    delete process.env.TEST_API_KEY;
    delete process.env.TEST_DUAL;
  });

  it("should read from environment variables", async () => {
    process.env.TEST_API_KEY = "test-value";
    const value = await adapter.get("API_KEY");
    expect(value).toBe("test-value");
  });

  it("should return undefined for missing keys", async () => {
    const value = await adapter.get("NONEXISTENT");
    expect(value).toBeUndefined();
  });

  it("should support set/get/delete overrides", async () => {
    await adapter.set("MY_KEY", "my-value");
    expect(await adapter.get("MY_KEY")).toBe("my-value");
    expect(await adapter.has("MY_KEY")).toBe(true);

    await adapter.delete("MY_KEY");
    expect(await adapter.get("MY_KEY")).toBeUndefined();
    expect(await adapter.has("MY_KEY")).toBe(false);
  });

  it("should prefer overrides over environment variables", async () => {
    process.env.TEST_DUAL = "env-value";
    await adapter.set("DUAL", "override-value");

    expect(await adapter.get("DUAL")).toBe("override-value");
    expect(process.env.TEST_DUAL).toBe("env-value");
  });

  it("should delete overrides and matching environment variables", async () => {
    process.env.TEST_DUAL = "env-value";
    await adapter.set("DUAL", "override-value");

    await adapter.delete("DUAL");

    expect(await adapter.get("DUAL")).toBeUndefined();
    expect(await adapter.has("DUAL")).toBe(false);
    expect(process.env.TEST_DUAL).toBeUndefined();
  });
});
