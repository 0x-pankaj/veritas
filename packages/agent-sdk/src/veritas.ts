import { hc } from "hono/client";
import type { AppType } from "@veritas/coordinator";
import {
  TESTNET,
  type BuyResult,
  type BuySpeed,
  type Category,
  type Eip3009Authorization,
  type UsdcAmount,
  type Verdict,
} from "@veritas/core";
import type { Eip3009Signer } from "./sign.js";
import type { GatewayAdapter } from "./gateway.js";

export interface VeritasOpts {
  /** Coordinator base URL (VERITAS_FACILITATOR_URL). */
  facilitatorUrl: string;
  /** Signs the buyer's EIP-3009 authorizations. */
  signer: Eip3009Signer;
  /** CAIP-2 settlement network; defaults to Arc Testnet. */
  network?: string;
  /** Optional Gateway balance view for `ensureDeposit`. */
  gateway?: GatewayAdapter;
}

export interface BuyParams {
  category: Category;
  /** Coverage key the sellers are matched on, e.g. "BTC/USD". */
  symbol: string;
  /** Human-readable query (informational; discovery matches on symbol). */
  query?: string;
  /** "verified" (K-seller consensus) or "fast" (single-seller reputation). */
  mode?: BuySpeed;
  /** Consensus fan-out width (verified mode). Defaults to 3. */
  k?: number;
  /** Client-side budget cap on total exposure (winners + fee), base units. */
  maxPrice: UsdcAmount;
}

/** A discovery listing (subset of the seller registry row). */
export interface AvailableData {
  id: string;
  name: string;
  price: UsdcAmount;
  category: string;
  coverage: string[];
  schemaDesc: string;
  freshnessSec: number;
  reputation: number;
}

type Client = ReturnType<typeof hc<AppType>>;

/**
 * The one-call buyer experience (PRODUCT §4.2). Handles discovery, quoting,
 * offchain signing, and settlement plumbing so the agent only sees verified
 * data + a proof + the cost. Consumes the coordinator via `hono/client` typed
 * RPC, so coordinator API drift is a compile error.
 */
export class Veritas {
  private readonly client: Client;
  private readonly signer: Eip3009Signer;
  private readonly network: string;
  private readonly gateway?: GatewayAdapter;

  constructor(opts: VeritasOpts) {
    this.client = hc<AppType>(opts.facilitatorUrl);
    this.signer = opts.signer;
    this.network = opts.network ?? TESTNET.arc.caip2;
    if (opts.gateway) this.gateway = opts.gateway;
  }

  /** Browse the verified-data catalog (PRODUCT §7.3). */
  async listAvailableData(filter?: {
    category?: Category;
    symbol?: string;
  }): Promise<AvailableData[]> {
    const res = await this.client.sellers.$get({
      query: {
        ...(filter?.category ? { category: filter.category } : {}),
        ...(filter?.symbol ? { symbol: filter.symbol } : {}),
      },
    });
    if (res.status !== 200) {
      throw new Error(`discovery failed (${res.status})`);
    }
    const { sellers } = await res.json();
    return sellers.map((s) => ({
      id: s.id,
      name: s.name,
      price: s.price,
      category: s.category,
      coverage: s.coverage,
      schemaDesc: s.schemaDesc,
      freshnessSec: s.freshnessSec,
      reputation: s.reputation,
    }));
  }

  /**
   * Ensure the buyer's Gateway balance covers `minUsdc` (base units). Requires
   * a configured `gateway`. Throws if the balance is short — depositing is a
   * one-time, signed Circle flow the production `GatewayAdapter` performs.
   */
  async ensureDeposit(minUsdc: UsdcAmount): Promise<void> {
    if (!this.gateway) {
      throw new Error("ensureDeposit requires a gateway adapter in VeritasOpts");
    }
    const have = await this.gateway.getBalance(this.signer.address);
    if (BigInt(have) >= BigInt(minUsdc)) return;
    if (!this.gateway.deposit) {
      throw new Error(
        `Gateway balance ${have} < ${minUsdc} and no deposit() configured`,
      );
    }
    await this.gateway.deposit((BigInt(minUsdc) - BigInt(have)).toString());
  }

  /**
   * Buy verified data. Quotes first (nothing signed), enforces `maxPrice`
   * client-side, pre-signs K+1 exact-amount auths (one per candidate + fee),
   * and sends them with the buy. Returns when the answer + on-chain verdict
   * arrive — settlement of winners is server-side and async; the agent never
   * waits on it (PRODUCT §2.2).
   */
  async buy(params: BuyParams): Promise<BuyResult> {
    if ((params.mode ?? "verified") === "fast") {
      // Fast mode = single-seller reputation-routed purchase (PRODUCT §2.3).
      // The coordinator MVP exposes only the consensus /quote+/buy routes
      // (P2-T7), so there is no single-seller settlement path yet.
      throw new Error(
        "fast mode is not yet supported by the coordinator (P3-T3b); use verified",
      );
    }

    const quoteRes = await this.client.quote.$post({
      json: { category: params.category, symbol: params.symbol, k: params.k ?? 3 },
    });
    if (quoteRes.status !== 200) {
      const body = (await quoteRes.json()) as { error?: string };
      throw new Error(body.error ?? `quote failed (${quoteRes.status})`);
    }
    const quote = await quoteRes.json();

    // Budget enforcement — abort BEFORE signing anything.
    if (BigInt(quote.maxExposure) > BigInt(params.maxPrice)) {
      throw new Error(
        `quote exceeds maxPrice: maxExposure ${quote.maxExposure} > ${params.maxPrice}`,
      );
    }

    // Pre-sign one exact-amount auth per candidate + one fee auth (K+1).
    const authorizations: Eip3009Authorization[] = await Promise.all(
      quote.candidates.map((cand) =>
        this.signer.sign({
          to: cand.payoutAddress,
          value: cand.price,
          network: this.network,
        }),
      ),
    );
    if (BigInt(quote.fee) > 0n) {
      authorizations.push(
        await this.signer.sign({
          to: quote.feeAddress,
          value: quote.fee,
          network: this.network,
        }),
      );
    }

    const buyRes = await this.client.buy.$post({
      json: { quoteId: quote.quoteId, authorizations },
    });
    if (buyRes.status !== 200) {
      const body = (await buyRes.json()) as { error?: string };
      throw new Error(body.error ?? `buy failed (${buyRes.status})`);
    }
    const result = await buyRes.json();

    const verdict: Verdict = {
      queryId: result.queryId,
      truth: result.verdict.truth,
      winners: result.verdict.winners,
      outliers: result.verdict.outliers,
      solanaTx: result.verdict.solanaTx,
    };
    return {
      queryId: result.queryId,
      data: result.data,
      verdict,
      finalCost: result.finalCost,
    };
  }

  /** Fetch a past verdict + proof for audit (PRODUCT §7.2). */
  async verify(queryId: string) {
    const res = await this.client.verify[":queryId"].$get({ param: { queryId } });
    if (res.status !== 200) throw new Error(`verify failed (${res.status})`);
    return res.json();
  }
}
