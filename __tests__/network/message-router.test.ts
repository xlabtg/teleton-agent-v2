import { describe, it, expect, beforeEach } from "vitest";
import {
  MessageRouter,
  RouteTable,
  TransportError,
} from "../../packages/network/src/message-router.js";
import type { AgentTransport, RouteEntry } from "../../packages/network/src/message-router.js";
import { createRequestMessage } from "../../packages/network/src/message-schema.js";
import type { AgentMessage } from "../../packages/network/src/message-schema.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeTransport(): {
  transport: AgentTransport;
  calls: { agentId: string; msg: AgentMessage }[];
} {
  const calls: { agentId: string; msg: AgentMessage }[] = [];
  const transport: AgentTransport = {
    async send(agentId, message) {
      calls.push({ agentId, msg: message });
    },
  };
  return { transport, calls };
}

function makeFailingTransport(
  error = new TransportError("unreachable", "agent-b")
): AgentTransport {
  return {
    async send() {
      throw error;
    },
  };
}

function makeRouter(
  agentId: string,
  transport: AgentTransport,
  routeTable: RouteTable
): MessageRouter {
  return new MessageRouter({ agentId, transport, routeTable });
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RouteTable", () => {
  it("should add and resolve a route", () => {
    const table = new RouteTable();
    const entry: RouteEntry = {
      destination: "agent-b",
      nextHop: "agent-b",
      metric: 1,
      namespace: "default",
    };
    table.addRoute(entry);
    expect(table.resolve("agent-b")).toEqual(entry);
  });

  it("should return the lowest-metric route", () => {
    const table = new RouteTable();
    table.addRoute({ destination: "agent-b", nextHop: "relay-1", metric: 5, namespace: "default" });
    table.addRoute({ destination: "agent-b", nextHop: "relay-2", metric: 2, namespace: "default" });
    expect(table.resolve("agent-b")?.nextHop).toBe("relay-2");
  });

  it("should return undefined when no route found", () => {
    const table = new RouteTable();
    expect(table.resolve("ghost")).toBeUndefined();
  });

  it("should remove routes", () => {
    const table = new RouteTable();
    table.addRoute({ destination: "agent-b", nextHop: "agent-b", metric: 1, namespace: "default" });
    table.removeRoutes("agent-b");
    expect(table.resolve("agent-b")).toBeUndefined();
  });

  it("should replace route with same nextHop on re-add", () => {
    const table = new RouteTable();
    table.addRoute({ destination: "agent-b", nextHop: "agent-b", metric: 5, namespace: "default" });
    table.addRoute({ destination: "agent-b", nextHop: "agent-b", metric: 1, namespace: "default" });
    const entries = table.resolve("agent-b");
    // metric should be updated to 1
    expect(entries?.metric).toBe(1);
  });

  it("should list destinations in namespace", () => {
    const table = new RouteTable();
    table.addRoute({ destination: "agent-b", nextHop: "agent-b", metric: 1, namespace: "default" });
    table.addRoute({ destination: "agent-c", nextHop: "agent-c", metric: 1, namespace: "default" });
    const dests = table.listDestinations("default");
    expect(dests).toContain("agent-b");
    expect(dests).toContain("agent-c");
  });
});

describe("MessageRouter", () => {
  let routeTable: RouteTable;

  beforeEach(() => {
    routeTable = new RouteTable();
    routeTable.addRoute({
      destination: "agent-b",
      nextHop: "agent-b",
      metric: 1,
      namespace: "default",
    });
  });

  describe("direct delivery", () => {
    it("should deliver a message directly when destination is self", async () => {
      const { transport } = makeTransport();
      const router = makeRouter("agent-b", transport, routeTable);

      const msg = createRequestMessage({ source: "agent-a", destination: "agent-b", action: "x" });
      const result = await router.route(msg);

      expect(result.outcome).toBe("delivered");
      expect(result.deliveredTo).toBe("agent-b");
    });

    it("should forward a message to a known destination via route table", async () => {
      const { transport, calls } = makeTransport();
      const router = makeRouter("agent-a", transport, routeTable);

      const msg = createRequestMessage({ source: "agent-a", destination: "agent-b", action: "x" });
      const result = await router.route(msg);

      expect(result.outcome).toBe("delivered");
      expect(result.deliveredTo).toBe("agent-b");
      expect(calls[0].agentId).toBe("agent-b");
    });

    it("should decrement TTL on each hop", async () => {
      const { transport, calls } = makeTransport();
      const router = makeRouter("agent-a", transport, routeTable);

      const msg = createRequestMessage({ source: "agent-a", destination: "agent-b", action: "x" });
      await router.route(msg);

      expect(calls[0].msg.routing.ttl).toBe(msg.routing.ttl - 1);
    });

    it("should append a hop record to path", async () => {
      const { transport, calls } = makeTransport();
      const router = makeRouter("agent-a", transport, routeTable);

      const msg = createRequestMessage({ source: "agent-a", destination: "agent-b", action: "x" });
      await router.route(msg);

      expect(calls[0].msg.routing.path.length).toBe(1);
      expect(calls[0].msg.routing.path[0].agentId).toBe("agent-a");
    });
  });

  describe("multi-hop routing via explicit waypoints", () => {
    it("should forward to the first via agent", async () => {
      const { transport, calls } = makeTransport();
      const router = makeRouter("agent-a", transport, routeTable);

      const msg = createRequestMessage({
        source: "agent-a",
        destination: "agent-c",
        action: "x",
        via: ["agent-b"],
      });
      await router.route(msg);

      expect(calls[0].agentId).toBe("agent-b");
      // The via list should consume agent-b for the next hop
      expect(calls[0].msg.routing.via).toEqual([]);
    });
  });

  describe("TTL enforcement", () => {
    it("should drop messages with TTL=0", async () => {
      const { transport } = makeTransport();
      const router = makeRouter("agent-a", transport, routeTable);

      const msg = createRequestMessage({
        source: "agent-a",
        destination: "agent-b",
        action: "x",
        ttl: 0,
      });
      const result = await router.route(msg);

      expect(result.outcome).toBe("dropped_ttl");
    });
  });

  describe("no route", () => {
    it("should return no_route when destination is unknown", async () => {
      const { transport } = makeTransport();
      const router = makeRouter("agent-a", transport, routeTable);

      const msg = createRequestMessage({
        source: "agent-a",
        destination: "unknown-agent",
        action: "x",
      });
      const result = await router.route(msg);

      expect(result.outcome).toBe("no_route");
    });
  });

  describe("transport error", () => {
    it("should return transport_error when send fails", async () => {
      const failingTransport = makeFailingTransport();
      const router = makeRouter("agent-a", failingTransport, routeTable);

      const msg = createRequestMessage({ source: "agent-a", destination: "agent-b", action: "x" });
      const result = await router.route(msg);

      expect(result.outcome).toBe("transport_error");
    });
  });

  describe("emitErrorOnFailure", () => {
    it("should send a protocol error back to source on no_route", async () => {
      const { transport, calls } = makeTransport();
      // Add a route back to the source so the error can be delivered
      routeTable.addRoute({
        destination: "agent-a",
        nextHop: "agent-a",
        metric: 1,
        namespace: "default",
      });
      const router = makeRouter("router-1", transport, routeTable);

      const msg = createRequestMessage({
        source: "agent-a",
        destination: "ghost-agent",
        action: "x",
      });
      const result = await router.route(msg);

      expect(result.outcome).toBe("no_route");
      expect(result.errorMessage).toBeDefined();
      // Error message should be sent back to agent-a
      const errorCall = calls.find((c) => c.agentId === "agent-a");
      expect(errorCall).toBeDefined();
      expect(errorCall?.msg.headers.type).toBe("error");
    });

    it("should not emit error when emitErrorOnFailure=false", async () => {
      const { transport, calls } = makeTransport();
      const router = new MessageRouter({
        agentId: "agent-a",
        transport,
        routeTable,
        emitErrorOnFailure: false,
      });

      const msg = createRequestMessage({
        source: "agent-a",
        destination: "ghost-agent",
        action: "x",
      });
      await router.route(msg);

      expect(calls.length).toBe(0);
    });
  });
});
