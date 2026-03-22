import { describe, it, expect, vi } from "vitest";
import { ApiGateway } from "../../packages/integrations/src/api-gateway.js";
import { HttpBaseAdapter } from "../../packages/integrations/src/api-adapter.js";
import { NotFoundError, ValidationError } from "../../packages/core/src/errors/domain-errors.js";
import type { ApiRequest, ApiResponse, AdapterMeta } from "../../packages/integrations/src/api-adapter.js";

// ---------------------------------------------------------------------------
// Mock adapter
// ---------------------------------------------------------------------------

interface MockCredential {
  apiKey: string;
}

class MockAdapter extends HttpBaseAdapter<MockCredential> {
  readonly meta: AdapterMeta = {
    serviceId: "mock",
    displayName: "Mock Service",
    baseUrl: "https://mock.example.com",
  };

  private _responseFactory: (req: ApiRequest) => ApiResponse;

  constructor(responseFactory?: (req: ApiRequest) => ApiResponse) {
    super({ baseUrl: "https://mock.example.com" });
    this._responseFactory = responseFactory ?? (() => ({
      status: 200,
      headers: {},
      body: { ok: true },
      durationMs: 5,
    }));
  }

  validateCredential(c: MockCredential): boolean {
    return typeof c.apiKey === "string" && c.apiKey.length > 0;
  }

  protected buildAuthHeaders(c: MockCredential): Record<string, string> {
    return { Authorization: `Bearer ${c.apiKey}` };
  }

  // Override execute to avoid real network calls
  override async execute<T>(req: ApiRequest, _cred: MockCredential): Promise<ApiResponse<T>> {
    return this._responseFactory(req) as ApiResponse<T>;
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApiGateway", () => {
  describe("register / deregister", () => {
    it("should register an adapter and list it", () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } } });
      gw.register(new MockAdapter());
      expect(gw.listServices()).toContain("mock");
    });

    it("should deregister an adapter", () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } } });
      gw.register(new MockAdapter());
      gw.deregister("mock");
      expect(gw.listServices()).not.toContain("mock");
    });
  });

  describe("execute()", () => {
    it("should execute a request and return the response", async () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } } });
      gw.register(new MockAdapter());
      const res = await gw.execute("mock", { method: "GET", path: "/hello" });
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ ok: true });
    });

    it("should throw NotFoundError for unregistered service", async () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } } });
      await expect(gw.execute("unknown", { method: "GET", path: "/" })).rejects.toThrow(NotFoundError);
    });

    it("should throw ValidationError when credential is invalid", async () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "" } } });
      gw.register(new MockAdapter());
      await expect(gw.execute("mock", { method: "GET", path: "/" })).rejects.toThrow(ValidationError);
    });
  });

  describe("interceptors", () => {
    it("should run request interceptors", async () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } } });
      gw.register(new MockAdapter());
      const spy = vi.fn((req: ApiRequest) => req);
      gw.addRequestInterceptor(spy);
      await gw.execute("mock", { method: "GET", path: "/" });
      expect(spy).toHaveBeenCalledOnce();
    });

    it("should run response interceptors", async () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } } });
      gw.register(new MockAdapter());
      const spy = vi.fn((res: ApiResponse) => res);
      gw.addResponseInterceptor(spy);
      await gw.execute("mock", { method: "GET", path: "/" });
      expect(spy).toHaveBeenCalledOnce();
    });
  });

  describe("usage tracking", () => {
    it("should record usage after each call", async () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } } });
      gw.register(new MockAdapter());
      await gw.execute("mock", { method: "GET", path: "/ping" });
      const log = gw.getUsageLog();
      expect(log).toHaveLength(1);
      expect(log[0].serviceId).toBe("mock");
      expect(log[0].path).toBe("/ping");
      expect(log[0].status).toBe(200);
    });

    it("should return usage summary aggregated by service", async () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } } });
      gw.register(new MockAdapter());
      await gw.execute("mock", { method: "GET", path: "/" });
      await gw.execute("mock", { method: "GET", path: "/" });
      const summary = gw.getUsageSummary();
      expect(summary["mock"].calls).toBe(2);
    });

    it("should prune oldest records at maxUsageRecords", async () => {
      const gw = new ApiGateway({ credentials: { mock: { apiKey: "key" } }, maxUsageRecords: 2 });
      gw.register(new MockAdapter());
      await gw.execute("mock", { method: "GET", path: "/1" });
      await gw.execute("mock", { method: "GET", path: "/2" });
      await gw.execute("mock", { method: "GET", path: "/3" });
      expect(gw.getUsageLog()).toHaveLength(2);
      expect(gw.getUsageLog()[0].path).toBe("/2");
    });
  });
});
