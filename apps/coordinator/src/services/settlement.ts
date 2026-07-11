import { createHash } from "node:crypto";
import type { BatchFacilitatorClient } from "@circle-fin/x402-batching/server";
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

export interface CircleSettlementConfig {
  /** Gateway API base URL, e.g. https://gateway-api-testnet.circle.com */
  gatewayApiUrl: string;
}

/** Per-network Gateway parameters advertised by /v1/x402/supported. */
interface GatewayKind {
  asset: string;
  verifyingContract: string;
}

/**
 * Real provider: Circle Gateway batched settlement via BatchFacilitatorClient
 * (@circle-fin/x402-batching, Nanopayments). Verify checks each auth's
 * signature against the GatewayWalletBatched EIP-712 domain server-side AND
 * (our addition) that the buyer's available Gateway balance covers the SUM of
 * all auths — per-auth balance checks alone would let K+1 auths each pass
 * individually while jointly exceeding the deposit. Settle redeems an auth;
 * Gateway credits the recipient's balance sub-second and batch-settles on
 * chain later (tracked by the reconciler).
 */
export class CircleSettlementProvider implements SettlementProvider {
  private clientPromise?: Promise<BatchFacilitatorClient>;
  private kinds?: Map<string, GatewayKind>;

  constructor(private readonly config: CircleSettlementConfig) {}

  private async client() {
    this.clientPromise ??= import("@circle-fin/x402-batching/server").then(
      (m) => new m.BatchFacilitatorClient({ url: this.config.gatewayApiUrl }),
    );
    return this.clientPromise;
  }

  /** network (CAIP-2) → {USDC asset, GatewayWallet verifyingContract}, from the live API. */
  private async kindFor(network: string): Promise<GatewayKind> {
    if (!this.kinds) {
      const supported = await (await this.client()).getSupported();
      this.kinds = new Map();
      for (const kind of supported.kinds) {
        const extra = kind.extra as
          | { verifyingContract?: string; assets?: { symbol: string; address: string }[] }
          | undefined;
        const usdc = extra?.assets?.find((a) => a.symbol === "USDC");
        if (extra?.verifyingContract && usdc) {
          this.kinds.set(kind.network, {
            asset: usdc.address,
            verifyingContract: extra.verifyingContract,
          });
        }
      }
    }
    const kind = this.kinds.get(network);
    if (!kind) throw new Error(`Gateway does not support network ${network}`);
    return kind;
  }

  private toX402(item: SettlementItem, kind: GatewayKind) {
    const a = item.authorization;
    return {
      payload: {
        x402Version: 2, // required by the Gateway x402 API
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
        asset: kind.asset,
        amount: item.amount,
        payTo: item.payTo,
        maxTimeoutSeconds: 7 * 24 * 3600 + 100, // Gateway minimum validity + buffer
        extra: {
          name: "GatewayWalletBatched",
          version: "1",
          verifyingContract: kind.verifyingContract,
        },
      },
    };
  }

  /** Buyer's available Gateway balance (base units) on `network`. */
  private async availableBalance(network: string, depositor: string): Promise<bigint> {
    const { CHAIN_CONFIGS } = await import("@circle-fin/x402-batching/client");
    const chainId = Number(network.split(":")[1]);
    const domain = Object.values(CHAIN_CONFIGS).find((c) => c.chain.id === chainId)?.domain;
    if (domain === undefined) throw new Error(`no Gateway domain for ${network}`);
    const res = await fetch(`${this.config.gatewayApiUrl}/v1/balances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ token: "USDC", sources: [{ domain, depositor }] }),
    });
    if (!res.ok) throw new Error(`Gateway balances API ${res.status}`);
    const body = (await res.json()) as { balances?: { balance?: string }[] };
    // API returns a decimal USDC string; convert to base units.
    const [int = "0", frac = ""] = (body.balances?.[0]?.balance ?? "0").split(".");
    return BigInt(int) * 1_000_000n + BigInt((frac + "000000").slice(0, 6));
  }

  async verifyAll(items: SettlementItem[]): Promise<boolean[]> {
    const now = Date.now();
    const client = await this.client();

    const results = await Promise.all(
      items.map(async (item) => {
        if (!checkAuthInvariants(item, now)) return false;
        try {
          const kind = await this.kindFor(item.network);
          const { payload, requirements } = this.toX402(item, kind);
          const res = await client.verify(payload, requirements);
          if (!res.isValid) {
            console.warn(`gateway verify rejected auth to ${item.payTo}: ${res.invalidReason}`);
          }
          return res.isValid === true;
        } catch (err) {
          console.warn(`gateway verify errored for auth to ${item.payTo}:`, err);
          return false;
        }
      }),
    );

    // Aggregate exposure check: per buyer+network, sum(auths) ≤ available balance.
    if (results.every(Boolean) && items.length > 0) {
      const totals = new Map<string, bigint>();
      for (const item of items) {
        const key = `${item.network}|${item.authorization.from.toLowerCase()}`;
        totals.set(key, (totals.get(key) ?? 0n) + BigInt(item.amount));
      }
      for (const [key, total] of totals) {
        const [network, from] = key.split("|") as [string, string];
        try {
          const available = await this.availableBalance(network, from);
          if (available < total) {
            console.warn(
              `buyer ${from} Gateway balance ${available} < total exposure ${total}`,
            );
            return items.map(() => false);
          }
        } catch (err) {
          console.warn(`gateway balance check failed for ${from}:`, err);
          return items.map(() => false);
        }
      }
    }
    return results;
  }

  async settleAll(items: SettlementItem[]): Promise<SettleReceipt[]> {
    const client = await this.client();
    return Promise.all(
      items.map(async (item): Promise<SettleReceipt> => {
        try {
          const kind = await this.kindFor(item.network);
          const { payload, requirements } = this.toX402(item, kind);
          const res = await client.settle(payload, requirements);
          if (!res.success) {
            console.warn(`gateway settle failed for ${item.payTo}: ${res.errorReason}`);
            return { txId: "", status: "FAILED" };
          }
          return { txId: res.transaction || "gateway-pending", status: "PENDING" };
        } catch (err) {
          console.warn(`gateway settle errored for ${item.payTo}:`, err);
          return { txId: "", status: "FAILED" };
        }
      }),
    );
  }
}

export function makeSettlementProvider(
  mock: boolean,
  config?: CircleSettlementConfig,
): SettlementProvider {
  if (mock) return new MockSettlementProvider();
  if (!config) throw new Error("real settlement (MOCK_SETTLE=false) requires GATEWAY_API_URL");
  return new CircleSettlementProvider(config);
}
