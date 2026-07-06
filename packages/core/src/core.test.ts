import { describe, expect, it } from "vitest";
import { canonicalJson, commitment, keccak256, sha256 } from "./hash.js";
import { envSchema, loadEnv } from "./env.js";
import { build402Body, parse402Body } from "./x402.js";
import { PROTOCOL } from "./constants.js";

describe("hash", () => {
  it("is deterministic", () => {
    expect(keccak256("x")).toBe(keccak256("x"));
    expect(sha256("x")).toBe(sha256("x"));
  });

  it("canonicalJson is key-order independent", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 2 }, b: 1 }),
    );
  });

  it("commitment matches for identical payloads regardless of key order", () => {
    expect(commitment({ price: 42, symbol: "BTC/USD" })).toBe(
      commitment({ symbol: "BTC/USD", price: 42 }),
    );
  });
});

describe("env", () => {
  it("throws a clear error listing missing vars", () => {
    expect(() =>
      loadEnv(envSchema.pick({ SOLANA_RPC: true, COORDINATOR_API_KEY: true }), {}),
    ).toThrow(/SOLANA_RPC/);
  });

  it("parses and transforms a valid subset", () => {
    const env = loadEnv(
      envSchema.pick({ MOCK_SETTLE: true, COORDINATOR_PORT: true }),
      { MOCK_SETTLE: "false", COORDINATOR_PORT: "4000" },
    );
    expect(env.MOCK_SETTLE).toBe(false);
    expect(env.COORDINATOR_PORT).toBe(4000);
  });
});

describe("x402", () => {
  it("builds and parses a 402 body round-trip", () => {
    const body = build402Body({
      scheme: "exact",
      network: "arcTestnet",
      maxAmountRequired: "1000",
      payTo: "0x1111111111111111111111111111111111111111",
      asset: "0x3600000000000000000000000000000000000000",
      extra: { veritas: { version: 1, sellerId: "s1", mode: "consensus" } },
    });
    const parsed = parse402Body(body);
    expect(parsed.maxAmountRequired).toBe("1000");
    expect(parsed.extra.veritas.sellerId).toBe("s1");
  });
});

describe("protocol constants", () => {
  it("K bounds are sane", () => {
    expect(PROTOCOL.MIN_K).toBeLessThanOrEqual(PROTOCOL.MAX_K);
    expect(PROTOCOL.MAX_K).toBe(7);
  });
});
