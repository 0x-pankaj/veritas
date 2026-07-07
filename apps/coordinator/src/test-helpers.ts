import { randomBytes } from "node:crypto";
import type { Eip3009Authorization } from "@veritas/core";
import type { BuyDeps } from "./app.js";
import { MockSettlementProvider } from "./services/settlement.js";

export const TEST_API_KEY = "test-coordinator-key-0123456789";
export const TEST_FEE_ADDRESS = "0x00000000000000000000000000000000000000Fe";

/** Deps for tests that never touch Solana (health/sellers routes). */
export function makeTestDeps(overrides: Partial<BuyDeps> = {}): BuyDeps {
  return {
    settlement: new MockSettlementProvider(),
    veritasClient: () => {
      throw new Error("veritasClient not configured in this test");
    },
    coordinatorApiKey: TEST_API_KEY,
    feeBps: 200,
    feeAddress: TEST_FEE_ADDRESS,
    ...overrides,
  };
}

/** A structurally-valid (mock-verifiable) EIP-3009 auth for tests. */
export function fakeAuth(args: {
  from?: string;
  to: string;
  value: string;
}): Eip3009Authorization {
  const now = Math.floor(Date.now() / 1000);
  return {
    from: args.from ?? "0x2222222222222222222222222222222222222222",
    to: args.to,
    value: args.value,
    validAfter: now - 60,
    validBefore: now + 600, // ~10 min (PRODUCT §2.2)
    nonce: `0x${randomBytes(32).toString("hex")}`,
    signature: `0x${randomBytes(65).toString("hex")}`,
  };
}
