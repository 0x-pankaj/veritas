import { createHash } from "node:crypto";
import type { Eip3009Authorization } from "@veritas/core";

/** One settlement item: a buyer authorization + what it must pay for. */
export interface SettlementItem {
  authorization: Eip3009Authorization;
  /** Seller payout address the auth MUST name. */
  payTo: string;
  /** Exact USDC base units the auth MUST carry. */
  amount: string;
  /** CAIP-2 network, e.g. "eip155:5042002" (Arc Testnet). */
  network: string;
}

export interface SettleReceipt {
  txId: string;
  status: "PENDING" | "FAILED";
}

/**
 * Settlement provider (PRODUCT §7.1). `verifyAll` runs BEFORE fan-out —
 * signature/amount/recipient/expiry checks close the free-oracle hole.
 * `settleAll` redeems ONLY winners' auths, after the verdict, off the
 * agent's critical path.
 */
export interface SettlementProvider {
  verifyAll(items: SettlementItem[]): Promise<boolean[]>;
  settleAll(items: SettlementItem[]): Promise<SettleReceipt[]>;
}

/** Structural invariants every auth must satisfy, mock or real. */
export function checkAuthInvariants(item: SettlementItem, nowMs: number): boolean {
  const a = item.authorization;
  return (
    a.to.toLowerCase() === item.payTo.toLowerCase() &&
    a.value === item.amount &&
    a.validBefore * 1000 > nowMs &&
    a.validAfter * 1000 <= nowMs &&
    /^0x[0-9a-fA-F]{64}$/.test(a.nonce) &&
    a.signature.length > 0
  );
}

/**
 * Mock provider (MOCK_SETTLE=true): enforces the same structural invariants
 * as the real rail and tracks nonce reuse, but does not verify EVM
 * signatures or move USDC. Deterministic pseudo tx ids.
 */
export class MockSettlementProvider implements SettlementProvider {
  private usedNonces = new Set<string>();

  async verifyAll(items: SettlementItem[]): Promise<boolean[]> {
    const now = Date.now();
    return items.map(
      (item) =>
        checkAuthInvariants(item, now) && !this.usedNonces.has(item.authorization.nonce),
    );
  }

  async settleAll(items: SettlementItem[]): Promise<SettleReceipt[]> {
    const now = Date.now();
    return items.map((item) => {
      if (!checkAuthInvariants(item, now) || this.usedNonces.has(item.authorization.nonce)) {
        return { txId: "", status: "FAILED" as const };
      }
      this.usedNonces.add(item.authorization.nonce);
      const txId = `mock-${createHash("sha256")
        .update(item.authorization.nonce + item.payTo + item.amount)
        .digest("hex")
        .slice(0, 32)}`;
      return { txId, status: "PENDING" as const };
    });
  }
}

/**
 * Real provider: Circle Gateway batched settlement via BatchFacilitatorClient
 * (@circle-fin/x402-batching). Wired but requires live Arc Testnet + a funded
 * Gateway balance to exercise — see PROGRESS.md P2-T6b.
 */
export class CircleSettlementProvider implements SettlementProvider {
  private clientPromise?: Promise<{
    verify: (p: unknown, r: unknown) => Promise<{ isValid: boolean }>;
    settle: (p: unknown, r: unknown) => Promise<{ success: boolean; transaction?: string }>;
  }>;

  private async client() {
    this.clientPromise ??= import("@circle-fin/x402-batching/server").then(
      (m) => new m.BatchFacilitatorClient() as never,
    );
    return this.clientPromise;
  }

  private toX402(item: SettlementItem): { payload: unknown; requirements: unknown } {
    const a = item.authorization;
    return {
      payload: {
        x402Version: 1,
        scheme: "exact",
        network: item.network,
        payload: {
          signature: a.signature,
          authorization: {
            from: a.from,
            to: a.to,
            value: a.value,
            validAfter: String(a.validAfter),
            validBefore: String(a.validBefore),
            nonce: a.nonce,
          },
        },
      },
      requirements: {
        scheme: "exact",
        network: item.network,
        maxAmountRequired: item.amount,
        payTo: item.payTo,
        asset: "", // filled by scheme config for Gateway batching
      },
    };
  }

  async verifyAll(items: SettlementItem[]): Promise<boolean[]> {
    const client = await this.client();
    return Promise.all(
      items.map(async (item) => {
        try {
          const { payload, requirements } = this.toX402(item);
          const res = await client.verify(payload, requirements);
          return res.isValid === true;
        } catch {
          return false;
        }
      }),
    );
  }

  async settleAll(items: SettlementItem[]): Promise<SettleReceipt[]> {
    const client = await this.client();
    return Promise.all(
      items.map(async (item): Promise<SettleReceipt> => {
        try {
          const { payload, requirements } = this.toX402(item);
          const res = await client.settle(payload, requirements);
          return res.success
            ? { txId: res.transaction ?? "gateway-pending", status: "PENDING" }
            : { txId: "", status: "FAILED" };
        } catch {
          return { txId: "", status: "FAILED" };
        }
      }),
    );
  }
}

export function makeSettlementProvider(mock: boolean): SettlementProvider {
  return mock ? new MockSettlementProvider() : new CircleSettlementProvider();
}
