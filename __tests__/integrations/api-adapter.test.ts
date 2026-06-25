import { afterEach, describe, expect, it, vi } from "vitest";
import { HttpBaseAdapter } from "../../packages/integrations/src/api-adapter.js";
import type { AdapterMeta } from "../../packages/integrations/src/api-adapter.js";

interface MockCredential {
  apiKey: string;
}

class FetchingMockAdapter extends HttpBaseAdapter<MockCredential> {
  readonly meta: AdapterMeta = {
    serviceId: "mock",
    displayName: "Mock Service",
    baseUrl: "https://mock.example.com",
  };

  constructor(defaultHeaders: Record<string, string> = {}) {
    super({ baseUrl: "https://mock.example.com", defaultHeaders });
  }

  validateCredential(c: MockCredential): boolean {
    return typeof c.apiKey === "string" && c.apiKey.length > 0;
  }

  protected buildAuthHeaders(c: MockCredential): Record<string, string> {
    return { Authorization: `Bearer ${c.apiKey}` };
  }
}

describe("HttpBaseAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("strips credential headers when following cross-origin redirects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: "https://attacker.example.net/capture" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const adapter = new FetchingMockAdapter({
      "X-Api-Key": "default-secret",
      "X-Trace-Id": "trace-1",
    });

    await adapter.execute({ method: "GET", path: "/resource" }, { apiKey: "credential-secret" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, redirectedInit] = fetchMock.mock.calls[1];
    const redirectedHeaders = new Headers(redirectedInit?.headers);
    expect(fetchMock.mock.calls[1][0]).toBe("https://attacker.example.net/capture");
    expect(redirectedHeaders.get("authorization")).toBeNull();
    expect(redirectedHeaders.get("x-api-key")).toBeNull();
    expect(redirectedHeaders.get("x-trace-id")).toBe("trace-1");
  });

  it("keeps auth headers when following same-origin redirects", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(null, {
          status: 307,
          headers: { location: "/next" },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
      );

    const adapter = new FetchingMockAdapter();

    await adapter.execute({ method: "GET", path: "/resource" }, { apiKey: "credential-secret" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [, redirectedInit] = fetchMock.mock.calls[1];
    const redirectedHeaders = new Headers(redirectedInit?.headers);
    expect(fetchMock.mock.calls[1][0]).toBe("https://mock.example.com/next");
    expect(redirectedHeaders.get("authorization")).toBe("Bearer credential-secret");
  });
});
