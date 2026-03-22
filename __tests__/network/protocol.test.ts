import { describe, it, expect } from "vitest";
import {
  parseSemVer,
  compareSemVer,
  checkCompatibility,
  negotiateVersion,
  validateHeaders,
  ProtocolErrorCode,
  SUPPORTED_VERSIONS,
  PROTOCOL_VERSION,
} from "../../packages/network/src/protocol.js";

describe("protocol", () => {
  describe("parseSemVer", () => {
    it("should parse a valid version string", () => {
      expect(parseSemVer("1.2.3")).toEqual({ major: 1, minor: 2, patch: 3 });
    });

    it("should parse 0.0.0", () => {
      expect(parseSemVer("0.0.0")).toEqual({ major: 0, minor: 0, patch: 0 });
    });

    it("should return null for non-semver strings", () => {
      expect(parseSemVer("1.2")).toBeNull();
      expect(parseSemVer("1.2.3.4")).toBeNull();
      expect(parseSemVer("one.two.three")).toBeNull();
      expect(parseSemVer("")).toBeNull();
      expect(parseSemVer("1.2.-1")).toBeNull();
    });
  });

  describe("compareSemVer", () => {
    it("should return 0 for equal versions", () => {
      expect(
        compareSemVer({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 3 })
      ).toBe(0);
    });

    it("should prioritise major version", () => {
      expect(
        compareSemVer({ major: 2, minor: 0, patch: 0 }, { major: 1, minor: 9, patch: 9 })
      ).toBe(1);
    });

    it("should compare minor version when major is equal", () => {
      expect(
        compareSemVer({ major: 1, minor: 3, patch: 0 }, { major: 1, minor: 2, patch: 9 })
      ).toBe(1);
    });

    it("should compare patch version when major and minor are equal", () => {
      expect(
        compareSemVer({ major: 1, minor: 2, patch: 4 }, { major: 1, minor: 2, patch: 3 })
      ).toBe(1);
      expect(
        compareSemVer({ major: 1, minor: 2, patch: 3 }, { major: 1, minor: 2, patch: 4 })
      ).toBe(-1);
    });
  });

  describe("checkCompatibility", () => {
    it("should be compatible for same major/minor", () => {
      const local = parseSemVer("1.0.0")!;
      const msg = parseSemVer("1.0.0")!;
      expect(checkCompatibility(local, msg)).toBe("compatible");
    });

    it("should be compatible when message minor is lower than local", () => {
      const local = parseSemVer("1.2.0")!;
      const msg = parseSemVer("1.1.0")!;
      expect(checkCompatibility(local, msg)).toBe("compatible");
    });

    it("should be forward-compatible when message minor is higher than local", () => {
      const local = parseSemVer("1.0.0")!;
      const msg = parseSemVer("1.1.0")!;
      expect(checkCompatibility(local, msg)).toBe("forward-compatible");
    });

    it("should be incompatible for different major versions", () => {
      const local = parseSemVer("1.0.0")!;
      const msg = parseSemVer("2.0.0")!;
      expect(checkCompatibility(local, msg)).toBe("incompatible");
    });
  });

  describe("negotiateVersion", () => {
    it("should return the highest common version", () => {
      const local = ["1.0.0", "1.1.0", "2.0.0"];
      const remote = ["0.9.0", "1.0.0", "1.1.0"];
      expect(negotiateVersion(local, remote)).toBe("1.1.0");
    });

    it("should return null when no common version exists", () => {
      expect(negotiateVersion(["1.0.0"], ["2.0.0"])).toBeNull();
    });

    it("should handle single-version lists", () => {
      expect(negotiateVersion(["1.0.0"], ["1.0.0"])).toBe("1.0.0");
    });

    it("should handle empty lists", () => {
      expect(negotiateVersion([], ["1.0.0"])).toBeNull();
      expect(negotiateVersion(["1.0.0"], [])).toBeNull();
    });

    it("should skip invalid version strings", () => {
      expect(negotiateVersion(["not-a-version", "1.0.0"], ["1.0.0"])).toBe("1.0.0");
    });
  });

  describe("validateHeaders", () => {
    const valid = {
      messageId: "msg-1",
      type: "request",
      protocolVersion: "1.0.0",
      createdAt: new Date().toISOString(),
      metadata: {},
    };

    it("should return no errors for valid headers", () => {
      expect(validateHeaders(valid)).toHaveLength(0);
    });

    it("should report missing messageId", () => {
      const errors = validateHeaders({ ...valid, messageId: "" });
      expect(errors.some((e) => e.includes("messageId"))).toBe(true);
    });

    it("should report invalid type", () => {
      const errors = validateHeaders({ ...valid, type: "unknown" });
      expect(errors.some((e) => e.includes("type"))).toBe(true);
    });

    it("should report missing protocolVersion", () => {
      const errors = validateHeaders({ ...valid, protocolVersion: "" });
      expect(errors.some((e) => e.includes("protocolVersion"))).toBe(true);
    });

    it("should report invalid semver in protocolVersion", () => {
      const errors = validateHeaders({ ...valid, protocolVersion: "not-a-version" });
      expect(errors.some((e) => e.includes("protocolVersion"))).toBe(true);
    });

    it("should report invalid createdAt", () => {
      const errors = validateHeaders({ ...valid, createdAt: "not-a-date" });
      expect(errors.some((e) => e.includes("createdAt"))).toBe(true);
    });

    it("should report non-object metadata", () => {
      const errors = validateHeaders({ ...valid, metadata: "string" });
      expect(errors.some((e) => e.includes("metadata"))).toBe(true);
    });
  });

  describe("constants", () => {
    it("PROTOCOL_VERSION should be in SUPPORTED_VERSIONS", () => {
      expect(SUPPORTED_VERSIONS).toContain(PROTOCOL_VERSION);
    });

    it("ProtocolErrorCode values should be unique strings", () => {
      const values = Object.values(ProtocolErrorCode);
      const unique = new Set(values);
      expect(unique.size).toBe(values.length);
    });
  });
});
