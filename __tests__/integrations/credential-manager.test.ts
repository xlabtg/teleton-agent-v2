import { describe, it, expect } from "vitest";
import { CredentialManager } from "../../packages/integrations/src/credential-manager.js";
import { NotFoundError, ConfigurationError } from "../../packages/core/src/errors/domain-errors.js";

describe("CredentialManager", () => {
  describe("set / get", () => {
    it("should store and retrieve a credential", () => {
      const mgr = new CredentialManager();
      mgr.set("openai", { apiKey: "sk-test" });
      expect(mgr.get("openai")).toEqual({ apiKey: "sk-test" });
    });

    it("should be case-insensitive for service IDs", () => {
      const mgr = new CredentialManager();
      mgr.set("OpenAI", { apiKey: "sk-test" });
      expect(mgr.get("openai")).toEqual({ apiKey: "sk-test" });
    });

    it("should overwrite an existing credential", () => {
      const mgr = new CredentialManager();
      mgr.set("svc", "v1");
      mgr.set("svc", "v2");
      expect(mgr.get("svc")).toBe("v2");
    });

    it("should throw NotFoundError for unknown service", () => {
      const mgr = new CredentialManager();
      expect(() => mgr.get("unknown")).toThrow(NotFoundError);
    });

    it("should throw ConfigurationError for empty service ID", () => {
      const mgr = new CredentialManager();
      expect(() => mgr.set("", "value")).toThrow(ConfigurationError);
    });

    it("should not retain a mutable reference to credentials passed to set()", () => {
      const mgr = new CredentialManager();
      const credential = { apiKey: "sk-test", nested: { scope: "read" } };

      mgr.set("openai", credential);
      credential.apiKey = "mutated";
      credential.nested.scope = "write";

      expect(mgr.get("openai")).toEqual({ apiKey: "sk-test", nested: { scope: "read" } });
    });

    it("should return defensive copies from get()", () => {
      const mgr = new CredentialManager();
      mgr.set("openai", { apiKey: "sk-test", nested: { scope: "read" } });

      const credential = mgr.get("openai") as { apiKey: string; nested: { scope: string } };
      expect(() => {
        credential.apiKey = "mutated";
      }).toThrow(TypeError);
      expect(() => {
        credential.nested.scope = "write";
      }).toThrow(TypeError);

      expect(mgr.get("openai")).toEqual({ apiKey: "sk-test", nested: { scope: "read" } });
    });
  });

  describe("has / delete", () => {
    it("has() returns true for registered service", () => {
      const mgr = new CredentialManager();
      mgr.set("svc", "val");
      expect(mgr.has("svc")).toBe(true);
    });

    it("has() returns false for unregistered service", () => {
      const mgr = new CredentialManager();
      expect(mgr.has("nope")).toBe(false);
    });

    it("delete() removes the credential", () => {
      const mgr = new CredentialManager();
      mgr.set("svc", "val");
      expect(mgr.delete("svc")).toBe(true);
      expect(mgr.has("svc")).toBe(false);
    });
  });

  describe("rotate()", () => {
    it("should replace the credential value", () => {
      const mgr = new CredentialManager();
      mgr.set("svc", "old");
      mgr.rotate("svc", "new");
      expect(mgr.get("svc")).toBe("new");
    });

    it("should throw NotFoundError when rotating unknown service", () => {
      const mgr = new CredentialManager();
      expect(() => mgr.rotate("unknown", "val")).toThrow(NotFoundError);
    });
  });

  describe("initial config", () => {
    it("should seed credentials from initial map", () => {
      const mgr = new CredentialManager({ initial: { telegram: "bot-token" } });
      expect(mgr.get("telegram")).toBe("bot-token");
    });

    it("should not retain mutable references from initial config", () => {
      const credential = { token: "bot-token", nested: { scope: "send" } };
      const mgr = new CredentialManager({ initial: { telegram: credential } });

      credential.token = "mutated";
      credential.nested.scope = "admin";

      expect(mgr.get("telegram")).toEqual({ token: "bot-token", nested: { scope: "send" } });
    });
  });

  describe("encryptionKey", () => {
    it("should retrieve credentials when in-memory encryption is enabled", () => {
      const mgr = new CredentialManager({
        encryptionKey: "test-key",
        initial: { openai: { apiKey: "sk-test" } },
      });

      expect(mgr.get("openai")).toEqual({ apiKey: "sk-test" });
    });
  });

  describe("getRecord()", () => {
    it("should include rotatedAt timestamp", () => {
      const mgr = new CredentialManager();
      mgr.set("svc", "val");
      const record = mgr.getRecord("svc");
      expect(typeof record.rotatedAt).toBe("string");
      expect(record.value).toBe("val");
    });

    it("should return a defensive copy of the record and metadata", () => {
      const mgr = new CredentialManager();
      mgr.set("svc", { apiKey: "sk-test" }, { expiresAt: "tomorrow", nested: { scope: "read" } });

      const record = mgr.getRecord("svc") as unknown as CredentialRecordForTest;
      expect(() => {
        record.serviceId = "other";
      }).toThrow(TypeError);
      expect(() => {
        record.value.apiKey = "mutated";
      }).toThrow(TypeError);
      expect(() => {
        record.meta.expiresAt = "yesterday";
      }).toThrow(TypeError);
      expect(() => {
        record.meta.nested.scope = "write";
      }).toThrow(TypeError);

      expect(mgr.getRecord("svc")).toMatchObject({
        serviceId: "svc",
        value: { apiKey: "sk-test" },
        meta: { expiresAt: "tomorrow", nested: { scope: "read" } },
      });
    });
  });

  describe("listServices()", () => {
    it("should return all registered service IDs", () => {
      const mgr = new CredentialManager({ initial: { a: 1, b: 2 } });
      expect(mgr.listServices().sort()).toEqual(["a", "b"]);
    });
  });
});

interface CredentialRecordForTest {
  serviceId: string;
  value: { apiKey: string };
  meta: { expiresAt: string; nested: { scope: string } };
}
