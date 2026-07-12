import { Veritas, CircleEip3009Signer, LocalEip3009Signer } from "@veritas/agent";
import type { Category } from "@veritas/core";
import { DEMO } from "../sellers/prices";

/** One seller's line in the verified result (for the UI). */
export interface DemoSellerResult {
  sellerId: string;
  name: string;
  /** The value this seller answered. */
  value: string;
  /** Won consensus (within tolerance of the truth)? */
  matched: boolean;
  reputation: number;
  /** USDC base units actually settled to this seller (winners only). */
  settled?: string;
}

/** The naive "trust one seller" contrast path. */
export interface NaiveResult {
  sellerName: string;
  value: string;
  /** What a naive x402 buyer would have paid regardless of correctness. */
  paid: string;
  /** Whether that single answer happened to be correct. */
  correct: boolean;
}

export interface DemoResult {
  mode: "live" | "mock";
  queryId: string;
  symbol: string;
  /** Consensus truth from Solana. */
  truth: string;
  solanaTx: string;
  requestPda?: string;
  sellers: DemoSellerResult[];
  /** Total USDC settled (winners + fee), base units. */
  finalCost: string;
  naive: NaiveResult;
  /** Present when the live stack was unreachable and we fell back to mock. */
  note?: string;
}

export interface RunDemoOpts {
  facilitatorUrl: string;
  category?: string;
  symbol?: string;
  k?: number;
  maxPrice?: string;
  /** Force the canned result (no coordinator/Devnet needed). */
  mock?: boolean;
  /** Buyer EVM address for the signer (demo). */
  buyerAddress?: string;
}

/** Within the coordinator's numeric tolerance (100 bps) of `truth`? */
function withinTolerance(value: number, truth: number, bps = 100): boolean {
  return Math.abs(value - truth) * 10_000 <= bps * Math.max(Math.abs(truth), 1);
}

/**
 * The canonical "liar caught by consensus" result, computed without any live
 * infrastructure. Also the fallback when the coordinator is unreachable, so
 * the demo page always renders a realistic-shaped result.
 */
export function mockDemoResult(symbol = DEMO.symbol): DemoResult {
  const truth = "50100";
  const sellers: DemoSellerResult[] = [
    { sellerId: "acme", name: "acme-prices", value: "50000", matched: true, reputation: 510, settled: "5000" },
    { sellerId: "globex", name: "globex-feed", value: "50100", matched: true, reputation: 510, settled: "5000" },
    { sellerId: "sketchy", name: "sketchy-oracle", value: "55000", matched: false, reputation: 490 },
  ];
  return {
    mode: "mock",
    queryId: "mock-".padEnd(16, "0"),
    symbol,
    truth,
    solanaTx: "MockSolanaTxSignature1111111111111111111111",
    sellers,
    finalCost: "10300", // 2 winners × 5000 + 300 fee
    naive: { sellerName: "sketchy-oracle", value: "55000", paid: "5000", correct: false },
  };
}

/**
 * Run the real verified purchase against the coordinator and compose a
 * UI-ready result: each seller's answer, who matched, the on-chain verdict,
 * winners paid on Arc, and the naive-x402 contrast (a single seller paid
 * regardless of correctness). Settlement is async, so we poll `/verify`
 * briefly to surface who actually got paid.
 */
export async function runDemo(opts: RunDemoOpts): Promise<DemoResult> {
  if (opts.mock) return mockDemoResult(opts.symbol);

  const symbol = opts.symbol ?? DEMO.symbol;
  // With ARC_PRIVATE_KEY set the demo signs REAL EIP-3009 auths and (when the
  // coordinator runs MOCK_SETTLE=false) real USDC moves on Arc Testnet.
  // Without it, the structurally-valid local signer keeps the mock-settle
  // demo runnable with zero setup.
  const arcKey = process.env.ARC_PRIVATE_KEY as `0x${string}` | undefined;
  const veritas = new Veritas({
    facilitatorUrl: opts.facilitatorUrl,
    signer: arcKey
      ? new CircleEip3009Signer(arcKey)
      : new LocalEip3009Signer(opts.buyerAddress),
  });

  const bought = await veritas.buy({
    category: (opts.category as Category | undefined) ?? DEMO.category,
    symbol,
    mode: "verified",
    k: opts.k ?? 3,
    maxPrice: opts.maxPrice ?? "20000",
  });

  // Discovery for names + current reputation.
  const catalog = await veritas.listAvailableData({ symbol });
  const byId = new Map(catalog.map((s) => [s.id, s]));

  // Poll /verify until settlements land (async, off the critical path).
  let audit = await veritas.verify(bought.queryId);
  for (let i = 0; i < 16 && audit.settlements.length === 0; i++) {
    await new Promise((r) => setTimeout(r, 250));
    audit = await veritas.verify(bought.queryId);
  }
  const settledBy = new Map(audit.settlements.map((s) => [s.sellerId, s.amount]));

  const truthNum = Number(bought.verdict.truth);
  const sellers: DemoSellerResult[] = audit.responses.map((r) => {
    const info = byId.get(r.sellerId);
    const result: DemoSellerResult = {
      sellerId: r.sellerId,
      name: info?.name ?? r.sellerId,
      value: r.valueOrHash,
      matched: r.matched === true,
      reputation: info?.reputation ?? 0,
    };
    const settled = settledBy.get(r.sellerId);
    if (settled) result.settled = settled;
    return result;
  });

  // Naive x402: trust one seller, pay regardless. Show the worst case (an
  // outlier if one exists) to make the contrast concrete.
  const outlier = sellers.find((s) => !s.matched) ?? sellers[0];
  const naive: NaiveResult = outlier
    ? {
        sellerName: outlier.name,
        value: outlier.value,
        paid: catalog.find((s) => s.id === outlier.sellerId)?.price ?? "0",
        correct: withinTolerance(Number(outlier.value), truthNum),
      }
    : { sellerName: "unknown", value: bought.verdict.truth, paid: "0", correct: true };

  const result: DemoResult = {
    mode: "live",
    queryId: bought.queryId,
    symbol,
    truth: bought.verdict.truth,
    solanaTx: bought.verdict.solanaTx,
    sellers,
    finalCost: bought.finalCost,
    naive,
  };
  if (audit.requestPda) result.requestPda = audit.requestPda;
  return result;
}
