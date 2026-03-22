import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  createRequestMessage,
  createResponseMessage,
  createEventMessage,
  createProtocolErrorMessage,
  isRequestMessage,
  isResponseMessage,
  isEventMessage,
  isProtocolErrorMessage,
} from "../../packages/network/src/message-schema.js";
import type { RequestMessage } from "../../packages/network/src/message-schema.js";

describe("message-schema", () => {
  describe("createRequestMessage", () => {
    it("should create a request message with required fields", () => {
      const msg = createRequestMessage({
        source: "agent-a",
        destination: "agent-b",
        action: "do-something",
      });

      expect(msg.headers.type).toBe("request");
      expect(msg.headers.protocolVersion).toBe(PROTOCOL_VERSION);
      expect(msg.headers.messageId).toBeTruthy();
      expect(msg.headers.createdAt).toBeTruthy();
      expect(msg.routing.source).toBe("agent-a");
      expect(msg.routing.destination).toBe("agent-b");
      expect(msg.routing.namespace).toBe("default");
      expect(msg.routing.ttl).toBe(10);
      expect(msg.payload.action).toBe("do-something");
      expect(msg.payload.args).toEqual({});
      expect(msg.payload.timeoutMs).toBe(30_000);
    });

    it("should use custom namespace, ttl, and args", () => {
      const msg = createRequestMessage({
        source: "a",
        destination: "b",
        action: "test",
        args: { key: "value" },
        namespace: "production",
        ttl: 5,
        timeoutMs: 5000,
      });

      expect(msg.routing.namespace).toBe("production");
      expect(msg.routing.ttl).toBe(5);
      expect(msg.payload.args).toEqual({ key: "value" });
      expect(msg.payload.timeoutMs).toBe(5000);
    });

    it("should support via routing", () => {
      const msg = createRequestMessage({
        source: "a",
        destination: "c",
        action: "hop",
        via: ["b"],
      });

      expect(msg.routing.via).toEqual(["b"]);
    });

    it("should generate unique message ids", () => {
      const msg1 = createRequestMessage({ source: "a", destination: "b", action: "x" });
      const msg2 = createRequestMessage({ source: "a", destination: "b", action: "x" });
      expect(msg1.headers.messageId).not.toBe(msg2.headers.messageId);
    });
  });

  describe("createResponseMessage", () => {
    it("should create a success response correlated to a request", () => {
      const req = createRequestMessage({ source: "a", destination: "b", action: "x" });
      const res = createResponseMessage(req, { success: true, result: { count: 42 } });

      expect(res.headers.type).toBe("response");
      expect(res.headers.correlationId).toBe(req.headers.messageId);
      expect(res.routing.source).toBe("b");
      expect(res.routing.destination).toBe("a");
      expect(res.payload.success).toBe(true);
      expect(res.payload.result).toEqual({ count: 42 });
    });

    it("should create an error response", () => {
      const req = createRequestMessage({ source: "a", destination: "b", action: "x" });
      const res = createResponseMessage(req, {
        success: false,
        error: { code: "NOT_FOUND", message: "Resource not found" },
      });

      expect(res.payload.success).toBe(false);
      expect(res.payload.error?.code).toBe("NOT_FOUND");
    });
  });

  describe("createEventMessage", () => {
    it("should create an event message", () => {
      const msg = createEventMessage({
        source: "a",
        destination: "*",
        eventType: "agent.task.completed",
        data: { taskId: "t-1" },
      });

      expect(msg.headers.type).toBe("event");
      expect(msg.payload.eventType).toBe("agent.task.completed");
      expect(msg.payload.data).toEqual({ taskId: "t-1" });
    });
  });

  describe("createProtocolErrorMessage", () => {
    it("should create a protocol error message", () => {
      const msg = createProtocolErrorMessage({
        source: "router",
        destination: "agent-a",
        code: "PROTOCOL_NO_ROUTE",
        message: "No route to agent-z",
        offendingMessageId: "msg-123",
      });

      expect(msg.headers.type).toBe("error");
      expect(msg.payload.code).toBe("PROTOCOL_NO_ROUTE");
      expect(msg.payload.offendingMessageId).toBe("msg-123");
    });
  });

  describe("type guards", () => {
    it("isRequestMessage should return true for request", () => {
      const msg = createRequestMessage({ source: "a", destination: "b", action: "x" });
      expect(isRequestMessage(msg)).toBe(true);
      expect(isResponseMessage(msg)).toBe(false);
    });

    it("isResponseMessage should return true for response", () => {
      const req = createRequestMessage({ source: "a", destination: "b", action: "x" });
      const res = createResponseMessage(req, { success: true });
      expect(isResponseMessage(res)).toBe(true);
      expect(isRequestMessage(res)).toBe(false);
    });

    it("isEventMessage should return true for event", () => {
      const msg = createEventMessage({ source: "a", destination: "b", eventType: "x" });
      expect(isEventMessage(msg)).toBe(true);
    });

    it("isProtocolErrorMessage should return true for error", () => {
      const msg = createProtocolErrorMessage({
        source: "a",
        destination: "b",
        code: "ERR",
        message: "fail",
      });
      expect(isProtocolErrorMessage(msg)).toBe(true);
    });
  });

  describe("routing.path", () => {
    it("should start with an empty path", () => {
      const msg = createRequestMessage({ source: "a", destination: "b", action: "x" });
      expect(msg.routing.path).toEqual([]);
    });
  });

  describe("metadata", () => {
    it("should carry custom metadata in headers", () => {
      const msg = createRequestMessage({
        source: "a",
        destination: "b",
        action: "x",
        metadata: { traceId: "trace-001" },
      });
      expect(msg.headers.metadata.traceId).toBe("trace-001");
    });
  });

  describe("RequestMessage type narrowing", () => {
    it("should narrow payload correctly via type guard", () => {
      const msg = createRequestMessage({ source: "a", destination: "b", action: "x" });
      if (isRequestMessage(msg)) {
        const req: RequestMessage = msg;
        expect(req.payload.action).toBe("x");
      }
    });
  });
});
