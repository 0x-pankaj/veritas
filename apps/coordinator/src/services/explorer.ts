import { desc, eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { queries, responses, sellers, settlements } from "../db/schema.js";

/** Match accuracy as a whole percent, or null when the seller has no rounds. */
export function accuracyPct(matched: number, served: number): number | null {
  if (served <= 0) return null;
  return Math.round((matched / served) * 100);
}

export interface EarningsBreakdown {
  /** Batch-settled on Arc (AVAILABLE). */
  settled: string;
  /** TEE-credited, awaiting batch settlement (PENDING). */
  pending: string;
  total: string;
}

/** Sum a seller's settlements into settled / pending / total (base units). */
export function aggregateEarnings(
  rows: { amount: string; status: string }[],
): EarningsBreakdown {
  let settled = 0n;
  let pending = 0n;
  for (const r of rows) {
    const a = BigInt(r.amount);
    if (r.status === "AVAILABLE") settled += a;
    else if (r.status === "PENDING") pending += a;
  }
  return {
    settled: settled.toString(),
    pending: pending.toString(),
    total: (settled + pending).toString(),
  };
}

export interface VerdictListItem {
  id: string;
  truth: string | null;
  status: string;
  k: number;
  cost: string | null;
  solanaTx: string | null;
  createdAt: string;
}

/** Recent verdicts for the truth-ledger explorer, newest first. */
export async function listVerdicts(db: Db, limit: number): Promise<VerdictListItem[]> {
  const rows = await db
    .select()
    .from(queries)
    .orderBy(desc(queries.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    truth: r.truth,
    status: r.status,
    k: r.k,
    cost: r.cost,
    solanaTx: r.solanaTx,
    createdAt: r.createdAt.toISOString(),
  }));
}

export interface SellerStats {
  id: string;
  name: string;
  solanaPubkey: string;
  reputation: number;
  served: number;
  matched: number;
  outliers: number;
  stake: string;
  status: string;
  accuracy: number | null;
  earnings: EarningsBreakdown;
}

/** All sellers with computed earnings + accuracy, ranked by reputation. */
export async function listSellerStats(db: Db): Promise<SellerStats[]> {
  const rows = await db
    .select()
    .from(sellers)
    .orderBy(desc(sellers.reputation), desc(sellers.matched));
  const setRows = await db
    .select({
      sellerId: settlements.sellerId,
      amount: settlements.amount,
      status: settlements.status,
    })
    .from(settlements);

  const bySeller = new Map<string, { amount: string; status: string }[]>();
  for (const s of setRows) {
    const list = bySeller.get(s.sellerId) ?? [];
    list.push({ amount: s.amount, status: s.status });
    bySeller.set(s.sellerId, list);
  }
  return rows.map((s) => ({
    id: s.id,
    name: s.name,
    solanaPubkey: s.solanaPubkey,
    reputation: s.reputation,
    served: s.served,
    matched: s.matched,
    outliers: s.outliers,
    stake: s.stake,
    status: s.status,
    accuracy: accuracyPct(s.matched, s.served),
    earnings: aggregateEarnings(bySeller.get(s.id) ?? []),
  }));
}

export interface SellerRoundRow {
  queryId: string;
  value: string;
  matched: boolean | null;
  latencyMs: number;
  truth: string | null;
  createdAt: string;
}
export interface SellerDetail {
  seller: SellerStats;
  rounds: SellerRoundRow[];
}

/** One seller's detail: stats + recent rounds. Null when unknown. */
export async function getSellerDetail(db: Db, id: string): Promise<SellerDetail | null> {
  const [seller] = await db.select().from(sellers).where(eq(sellers.id, id));
  if (!seller) return null;

  const setRows = await db
    .select({ amount: settlements.amount, status: settlements.status })
    .from(settlements)
    .where(eq(settlements.sellerId, id));

  const rounds = await db
    .select({
      queryId: responses.queryId,
      value: responses.valueOrHash,
      matched: responses.matched,
      latencyMs: responses.latencyMs,
      truth: queries.truth,
      createdAt: queries.createdAt,
    })
    .from(responses)
    .innerJoin(queries, eq(responses.queryId, queries.id))
    .where(eq(responses.sellerId, id))
    .orderBy(desc(queries.createdAt))
    .limit(50);

  return {
    seller: {
      id: seller.id,
      name: seller.name,
      solanaPubkey: seller.solanaPubkey,
      reputation: seller.reputation,
      served: seller.served,
      matched: seller.matched,
      outliers: seller.outliers,
      stake: seller.stake,
      status: seller.status,
      accuracy: accuracyPct(seller.matched, seller.served),
      earnings: aggregateEarnings(setRows),
    },
    rounds: rounds.map((r) => ({
      queryId: r.queryId,
      value: r.value,
      matched: r.matched,
      latencyMs: r.latencyMs,
      truth: r.truth,
      createdAt: r.createdAt.toISOString(),
    })),
  };
}
