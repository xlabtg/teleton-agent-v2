import { describe, it, expect, vi, beforeEach, afterEach, type MockInstance } from "vitest";
import { warnIfInsecure } from "../../packages/api/src/server.js";

describe("warnIfInsecure", () => {
  let warnSpy: MockInstance;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not warn for localhost", () => {
    warnIfInsecure({ host: "localhost", tls: undefined });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn for 127.0.0.1", () => {
    warnIfInsecure({ host: "127.0.0.1", tls: undefined });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn for 127.x.x.x loopback range", () => {
    warnIfInsecure({ host: "127.0.0.2", tls: undefined });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("does not warn for ::1 (IPv6 loopback)", () => {
    warnIfInsecure({ host: "::1", tls: undefined });
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it("warns when bound to 0.0.0.0 without TLS", () => {
    warnIfInsecure({ host: "0.0.0.0", tls: undefined });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("WARNING"));
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("TLS"));
  });

  it("warns when bound to a public IP without TLS", () => {
    warnIfInsecure({ host: "10.0.0.1", tls: undefined });
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("WARNING"));
  });

  it("does not warn when TLS is configured on a public address", () => {
    warnIfInsecure({
      host: "0.0.0.0",
      tls: { keyPath: "/etc/tls/key.pem", certPath: "/etc/tls/cert.pem" },
    });
    expect(warnSpy).not.toHaveBeenCalled();
  });
});

describe("HSTS header", () => {
  it("security headers middleware sets HSTS with preload", async () => {
    const { securityHeadersMiddleware } =
      await import("../../packages/api/src/middleware/security.middleware.js");
    const middleware = securityHeadersMiddleware();

    const headers: Record<string, string> = {};
    const ctx = {
      header: (name: string, value: string) => {
        headers[name.toLowerCase()] = value;
      },
    };
    const next = async () => {};

    await middleware(ctx as never, next);

    expect(headers["strict-transport-security"]).toMatch(/max-age=31536000/);
    expect(headers["strict-transport-security"]).toMatch(/includeSubDomains/);
    expect(headers["strict-transport-security"]).toMatch(/preload/);
  });
});

describe("TLS config schema", () => {
  it("accepts valid TLS configuration", async () => {
    const { tlsConfigSchema } = await import("../../configs/config.schema.js");
    const result = tlsConfigSchema.parse({
      key_path: "/etc/tls/key.pem",
      cert_path: "/etc/tls/cert.pem",
    });
    expect(result.key_path).toBe("/etc/tls/key.pem");
    expect(result.cert_path).toBe("/etc/tls/cert.pem");
    expect(result.http_redirect_port).toBeUndefined();
  });

  it("accepts TLS config with http_redirect_port", async () => {
    const { tlsConfigSchema } = await import("../../configs/config.schema.js");
    const result = tlsConfigSchema.parse({
      key_path: "/etc/tls/key.pem",
      cert_path: "/etc/tls/cert.pem",
      http_redirect_port: 80,
    });
    expect(result.http_redirect_port).toBe(80);
  });

  it("rejects TLS config with missing key_path", async () => {
    const { tlsConfigSchema } = await import("../../configs/config.schema.js");
    expect(() => tlsConfigSchema.parse({ cert_path: "/etc/tls/cert.pem" })).toThrow();
  });

  it("rejects TLS config with missing cert_path", async () => {
    const { tlsConfigSchema } = await import("../../configs/config.schema.js");
    expect(() => tlsConfigSchema.parse({ key_path: "/etc/tls/key.pem" })).toThrow();
  });
});

describe("API config schema TLS integration", () => {
  it("api config is valid without TLS (default)", async () => {
    const { apiConfigSchema } = await import("../../configs/config.schema.js");
    const result = apiConfigSchema.parse({});
    expect(result.tls).toBeUndefined();
    expect(result.port).toBe(3000);
    expect(result.host).toBe("0.0.0.0");
  });

  it("api config accepts optional TLS block", async () => {
    const { apiConfigSchema } = await import("../../configs/config.schema.js");
    const result = apiConfigSchema.parse({
      port: 443,
      host: "0.0.0.0",
      tls: { key_path: "/tls/key.pem", cert_path: "/tls/cert.pem", http_redirect_port: 80 },
    });
    expect(result.tls?.key_path).toBe("/tls/key.pem");
    expect(result.tls?.cert_path).toBe("/tls/cert.pem");
    expect(result.tls?.http_redirect_port).toBe(80);
  });
});
