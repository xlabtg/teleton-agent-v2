/**
 * TON transfer input validation tests.
 * Tests the validation logic in sendTon() by mocking external wallet services.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock all external wallet dependencies before importing sendTon
vi.mock("../../v1-src/ton/wallet-service.js", () => ({
  getKeyPair: vi.fn().mockResolvedValue({
    publicKey: new Uint8Array(32),
    secretKey: new Uint8Array(64),
  }),
  getCachedTonClient: vi.fn().mockResolvedValue({
    open: vi.fn().mockReturnValue({
      getSeqno: vi.fn().mockResolvedValue(1),
      sendTransfer: vi.fn().mockResolvedValue(undefined),
    }),
  }),
  invalidateTonClientCache: vi.fn(),
}));

vi.mock("../../v1-src/ton/tx-lock.js", () => ({
  withTxLock: vi.fn().mockImplementation((fn: () => Promise<unknown>) => fn()),
}));

vi.mock("@ton/ton", () => ({
  WalletContractV5R1: {
    create: vi.fn().mockReturnValue({}),
  },
  toNano: vi.fn().mockImplementation((n: number) => BigInt(Math.floor(n * 1e9))),
  internal: vi.fn().mockReturnValue({}),
}));

vi.mock("@ton/core", () => ({
  Address: {
    parse: vi.fn().mockImplementation((addr: string) => {
      // Simulate rejection for obviously invalid addresses
      if (!addr || addr.length < 10) {
        throw new Error(`Invalid address: ${addr}`);
      }
      return { toString: () => addr };
    }),
  },
  SendMode: { PAY_GAS_SEPARATELY: 1 },
}));

vi.mock("../../v1-src/utils/logger.js", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
  }),
}));

const { sendTon } = await import("../../v1-src/ton/transfer.js");

describe("sendTon — input validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should return null for zero amount", async () => {
    const result = await sendTon({ toAddress: "EQA_valid_address_placeholder", amount: 0 });
    expect(result).toBeNull();
  });

  it("should return null for negative amount", async () => {
    const result = await sendTon({ toAddress: "EQA_valid_address_placeholder", amount: -1 });
    expect(result).toBeNull();
  });

  it("should return null for NaN amount", async () => {
    const result = await sendTon({ toAddress: "EQA_valid_address_placeholder", amount: NaN });
    expect(result).toBeNull();
  });

  it("should return null for Infinity amount", async () => {
    const result = await sendTon({
      toAddress: "EQA_valid_address_placeholder",
      amount: Infinity,
    });
    expect(result).toBeNull();
  });

  it("should return null for amount exceeding MAX_TON_AMOUNT", async () => {
    const result = await sendTon({
      toAddress: "EQA_valid_address_placeholder",
      amount: 1_000_000_001,
    });
    expect(result).toBeNull();
  });

  it("should return null for an invalid TON address", async () => {
    const result = await sendTon({ toAddress: "bad", amount: 1 });
    expect(result).toBeNull();
  });

  it("should return null for a comment exceeding 127 bytes", async () => {
    const longComment = "x".repeat(128); // 128 bytes > 127 limit
    const result = await sendTon({
      toAddress: "EQA_valid_address_placeholder",
      amount: 1,
      comment: longComment,
    });
    expect(result).toBeNull();
  });

  it("should succeed for a valid transfer with all params", async () => {
    const result = await sendTon({
      toAddress: "EQA_valid_address_placeholder",
      amount: 1.5,
      comment: "test payment",
      bounce: false,
    });
    // Returns a pseudo-hash string on success
    expect(typeof result).toBe("string");
  });

  it("should succeed with exactly 127-byte comment", async () => {
    const exactComment = "x".repeat(127);
    const result = await sendTon({
      toAddress: "EQA_valid_address_placeholder",
      amount: 1,
      comment: exactComment,
    });
    expect(typeof result).toBe("string");
  });
});
