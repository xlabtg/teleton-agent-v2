import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolContext } from "../../v1-src/agent/tools/types.js";

const mocks = vi.hoisted(() => ({
  addressParse: vi.fn((address: string) => ({ address })),
  beginCell: vi.fn(),
  internal: vi.fn((message) => message),
  sendTon: vi.fn(),
  loadWallet: vi.fn(),
  getKeyPair: vi.fn(),
  getCachedTonClient: vi.fn(),
  tonapiFetch: vi.fn(),
  walletV5R1Create: vi.fn(),
  toNano: vi.fn((value: string | number) => BigInt(Math.trunc(Number(value) * 1_000_000_000))),
}));

vi.mock("@ton/core", () => ({
  Address: { parse: mocks.addressParse },
  SendMode: { PAY_GAS_SEPARATELY: 1 },
  beginCell: mocks.beginCell,
}));

vi.mock("@ton/ton", () => ({
  WalletContractV5R1: { create: mocks.walletV5R1Create },
  internal: mocks.internal,
  toNano: mocks.toNano,
}));

vi.mock("../../v1-src/ton/transfer.js", () => ({
  sendTon: mocks.sendTon,
}));

vi.mock("../../v1-src/ton/wallet-service.js", () => ({
  loadWallet: mocks.loadWallet,
  getKeyPair: mocks.getKeyPair,
  getCachedTonClient: mocks.getCachedTonClient,
}));

vi.mock("../../v1-src/constants/api-endpoints.js", () => ({
  tonapiFetch: mocks.tonapiFetch,
}));

vi.mock("../../v1-src/ton/tx-lock.js", () => ({
  withTxLock: vi.fn((fn: () => unknown) => fn()),
}));

import { tonSendExecutor, tonSendTool } from "../../v1-src/agent/tools/ton/send.js";
import { jettonSendExecutor, jettonSendTool } from "../../v1-src/agent/tools/ton/jetton-send.js";

const context = {
  bridge: {},
  db: {},
  chatId: "chat",
  senderId: 1,
  isGroup: false,
} as ToolContext;

function mockCellBuilder() {
  const builder = {
    storeUint: vi.fn(() => builder),
    storeCoins: vi.fn(() => builder),
    storeAddress: vi.fn(() => builder),
    storeBit: vi.fn(() => builder),
    storeStringTail: vi.fn(() => builder),
    storeRef: vi.fn(() => builder),
    endCell: vi.fn(() => ({ cell: true })),
  };
  return builder;
}

describe("TON transfer tools bounce parameter", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.addressParse.mockImplementation((address: string) => ({ address }));
    mocks.sendTon.mockResolvedValue("tx-ref");
    mocks.loadWallet.mockReturnValue({ address: "EQ_sender" });
    mocks.getKeyPair.mockResolvedValue({
      publicKey: new Uint8Array([1]),
      secretKey: new Uint8Array([2]),
    });
    mocks.getCachedTonClient.mockResolvedValue({
      open: vi.fn(() => ({
        getSeqno: vi.fn().mockResolvedValue(7),
        sendTransfer: vi.fn().mockResolvedValue(undefined),
      })),
    });
    mocks.walletV5R1Create.mockReturnValue({ wallet: true });
    mocks.tonapiFetch.mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          balances: [
            {
              jetton: {
                address: "EQ_jetton",
                decimals: 9,
                symbol: "JET",
              },
              wallet_address: { address: "EQ_sender_jetton_wallet" },
              balance: "10000000000",
            },
          ],
        }),
    });
    mocks.beginCell.mockImplementation(mockCellBuilder);
  });

  it("exposes bounce in ton_send schema and forwards explicit true to sendTon", async () => {
    expect(tonSendTool.parameters.properties).toHaveProperty("bounce");

    const result = await tonSendExecutor(
      {
        to: "EQ_recipient",
        amount: 1.5,
        comment: "memo",
        bounce: true,
      },
      context
    );

    expect(result.success).toBe(true);
    expect(mocks.sendTon).toHaveBeenCalledWith({
      toAddress: "EQ_recipient",
      amount: 1.5,
      comment: "memo",
      bounce: true,
    });
  });

  it("keeps ton_send non-bounceable by default", async () => {
    await tonSendExecutor({ to: "EQ_recipient", amount: 1 }, context);

    expect(mocks.sendTon).toHaveBeenCalledWith({
      toAddress: "EQ_recipient",
      amount: 1,
      comment: undefined,
      bounce: false,
    });
  });

  it("exposes bounce in jetton_send schema and applies explicit false to the internal message", async () => {
    expect(jettonSendTool.parameters.properties).toHaveProperty("bounce");

    const result = await jettonSendExecutor(
      {
        jetton_address: "EQ_jetton",
        to: "EQ_recipient",
        amount: 1,
        bounce: false,
      },
      context
    );

    expect(result.success).toBe(true);
    expect(mocks.internal).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { address: "EQ_sender_jetton_wallet" },
        bounce: false,
      })
    );
  });

  it("keeps jetton_send bounceable by default", async () => {
    await jettonSendExecutor(
      {
        jetton_address: "EQ_jetton",
        to: "EQ_recipient",
        amount: 1,
      },
      context
    );

    expect(mocks.internal).toHaveBeenCalledWith(
      expect.objectContaining({
        to: { address: "EQ_sender_jetton_wallet" },
        bounce: true,
      })
    );
  });
});
