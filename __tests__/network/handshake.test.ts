import { describe, it, expect } from "vitest";
import { HandshakeManager, HandshakeError } from "../../packages/network/src/handshake.js";

function makeManagers() {
  const initiator = new HandshakeManager({
    agentId: "agent-a",
    capabilities: { "code-review": "Reviews code" },
  });
  const responder = new HandshakeManager({
    agentId: "agent-b",
    capabilities: { "ton-transfer": "Transfers TON" },
  });
  return { initiator, responder };
}

describe("HandshakeManager", () => {
  describe("full handshake sequence (initiator + responder)", () => {
    it("should complete a successful handshake", () => {
      const { initiator, responder } = makeManagers();

      // Step 1: Initiator sends HELLO
      const { sessionId: initSessionId, payload: hello } = initiator.initiateHandshake("agent-b");
      expect(hello.step).toBe("HELLO");
      expect(hello.supportedVersions).toBeDefined();
      expect(hello.capabilities).toEqual({ "code-review": "Reviews code" });

      // Step 2: Responder handles HELLO → HELLO_ACK
      const { sessionId: respSessionId, payload: ack } = responder.handleHello(hello, "agent-a");
      expect(ack.step).toBe("HELLO_ACK");
      expect(ack.supportedVersions).toBeDefined();

      // Step 3: Initiator handles HELLO_ACK → CONFIRM
      const confirm = initiator.handleHelloAck(initSessionId, ack);
      expect(confirm.step).toBe("CONFIRM");
      expect(confirm.negotiatedVersion).toBeDefined();

      // Step 4: Responder handles CONFIRM → CONFIRM_ACK
      const confirmAck = responder.handleConfirm(respSessionId, confirm);
      expect(confirmAck.step).toBe("CONFIRM_ACK");

      // Step 5: Initiator handles CONFIRM_ACK → session confirmed
      initiator.handleConfirmAck(initSessionId, confirmAck);

      const initiatorSession = initiator.getSession(initSessionId)!;
      expect(initiatorSession.status).toBe("confirmed");
      expect(initiatorSession.protocolVersion).toBe("1.0.0");
      expect(initiatorSession.responderCapabilities).toEqual({ "ton-transfer": "Transfers TON" });

      const responderSession = responder.getSession(respSessionId)!;
      expect(responderSession.status).toBe("confirmed");
    });
  });

  describe("initiateHandshake", () => {
    it("should create a session in hello_sent status", () => {
      const { initiator } = makeManagers();
      const { sessionId } = initiator.initiateHandshake("agent-b");
      const session = initiator.getSession(sessionId)!;
      expect(session.status).toBe("hello_sent");
      expect(session.initiatorId).toBe("agent-a");
      expect(session.responderId).toBe("agent-b");
    });
  });

  describe("handleHello — version mismatch", () => {
    it("should return REJECT when no common version exists", () => {
      const initiator = new HandshakeManager({
        agentId: "agent-a",
        supportedVersions: ["2.0.0"],
      });
      const responder = new HandshakeManager({
        agentId: "agent-b",
        supportedVersions: ["1.0.0"],
      });

      const { payload: hello } = initiator.initiateHandshake("agent-b");
      const { payload: ack } = responder.handleHello(hello, "agent-a");
      expect(ack.step).toBe("REJECT");
      expect(ack.errorCode).toBeDefined();
    });
  });

  describe("handleHelloAck — version mismatch", () => {
    it("should throw HandshakeError when responder returns a REJECT", () => {
      const { initiator, responder } = makeManagers();
      const { sessionId } = initiator.initiateHandshake("agent-b");

      // Manually craft a REJECT response
      const rejectPayload = {
        step: "REJECT" as const,
        reason: "Nope",
        errorCode: "PROTOCOL_VERSION_MISMATCH",
      };
      void responder; // responder not needed for this particular assertion

      expect(() => initiator.handleHelloAck(sessionId, rejectPayload)).toThrow(HandshakeError);
    });
  });

  describe("handleHelloAck — wrong step", () => {
    it("should throw HandshakeError on unexpected step", () => {
      const { initiator } = makeManagers();
      const { sessionId } = initiator.initiateHandshake("agent-b");
      expect(() => initiator.handleHelloAck(sessionId, { step: "CONFIRM_ACK" })).toThrow(
        HandshakeError
      );
    });
  });

  describe("handleConfirm — version disagreement", () => {
    it("should return REJECT when confirmed version differs from agreed", () => {
      const { initiator, responder } = makeManagers();
      const { payload: hello } = initiator.initiateHandshake("agent-b");
      const { sessionId: respSessionId } = responder.handleHello(hello, "agent-a");
      // Simulate a tampered CONFIRM with wrong version
      const tamperedConfirm = { step: "CONFIRM" as const, negotiatedVersion: "9.9.9" };
      const rejectAck = responder.handleConfirm(respSessionId, tamperedConfirm);
      expect(rejectAck.step).toBe("REJECT");
    });
  });

  describe("purgeExpired", () => {
    it("should expire sessions that have been pending too long", () => {
      const mgr = new HandshakeManager({ agentId: "agent-a", sessionTimeoutMs: 1 });
      mgr.initiateHandshake("agent-b");
      // Force updatedAt into the past
      const [session] = mgr.listSessions("hello_sent");
      (session as { updatedAt: Date }).updatedAt = new Date(0);
      const removed = mgr.purgeExpired();
      expect(removed).toBe(1);
    });

    it("should not expire confirmed sessions", () => {
      const { initiator, responder } = makeManagers();
      const { sessionId: initId, payload: hello } = initiator.initiateHandshake("agent-b");
      const { sessionId: respId, payload: ack } = responder.handleHello(hello, "agent-a");
      const confirm = initiator.handleHelloAck(initId, ack);
      const confirmAck = responder.handleConfirm(respId, confirm);
      initiator.handleConfirmAck(initId, confirmAck);
      expect(initiator.purgeExpired()).toBe(0);
    });
  });

  describe("listSessions", () => {
    it("should filter sessions by status", () => {
      const { initiator } = makeManagers();
      initiator.initiateHandshake("agent-b");
      initiator.initiateHandshake("agent-c");
      expect(initiator.listSessions("hello_sent").length).toBe(2);
      expect(initiator.listSessions("confirmed").length).toBe(0);
    });
  });

  describe("getSession — unknown id", () => {
    it("should return undefined for unknown session id", () => {
      const { initiator } = makeManagers();
      expect(initiator.getSession("nonexistent")).toBeUndefined();
    });
  });
});
