import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "./db";
import { accuracyPct, aggregateEarnings, type EarningsBreakdown } from "./format";

/** Never let a DB hiccup crash a page — log and fall back. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[dashboard] db error:", err);
    return fallback;
  }
}

export interface VerdictRow {
  id: string;
  truth: string | null;
  status: string;
  k: number;
  cost: string | null;
  solanaTx: string | null;
  createdAt: Date;
}

/** Recent verdicts for the truth-ledger explorer, newest first. */
export function listVerdicts(limit = 25): Promise<VerdictRow[]> {
  return safe(async () => {
    const db = getDb();
    const rows = await db
      .select()
      .from(schema.queries)
      .orderBy(desc(schema.queries.createdAt))
      .limit(limit);
    return rows.map((r) => ({
      id: r.id,
      truth: r.truth,
      status: r.status,
      k: r.k,
      cost: r.cost,
      solanaTx: r.solanaTx,
      createdAt: r.createdAt,
    }));
  }, []);
}

export interface VerdictResponse {
  sellerId: string;
  name: string;
  value: string;
  matched: boolean | null;
  latencyMs: number;
}
export interface VerdictSettlement {
  sellerId: string;
  name: string;
  amount: string;
  status: string;
  gatewayTx: string | null;
}
export interface VerdictDetail {
  query: schema.Query;
  responses: VerdictResponse[];
  settlements: VerdictSettlement[];
}

/** A single verdict: the round, each seller's answer, and who got paid. */
export function getVerdict(queryId: string): Promise<VerdictDetail | null> {
  return safe(async () => {
    const db = getDb();
    const [query] = await db
      .select()
      .from(schema.queries)
      .where(eq(schema.queries.id, queryId));
    if (!query) return null;

    const responses = await db
      .select({
        sellerId: schema.responses.sellerId,
        name: schema.sellers.name,
        value: schema.responses.valueOrHash,
        matched: schema.responses.matched,
        latencyMs: schema.responses.latencyMs,
      })
      .from(schema.responses)
      .innerJoin(schema.sellers, eq(schema.responses.sellerId, schema.sellers.id))
      .where(eq(schema.responses.queryId, queryId));

    const settlements = await db
      .select({
        sellerId: schema.settlements.sellerId,
        name: schema.sellers.name,
        amount: schema.settlements.amount,
        status: schema.settlements.status,
        gatewayTx: schema.settlements.gatewayTx,
      })
      .from(schema.settlements)
      .innerJoin(schema.sellers, eq(schema.settlements.sellerId, schema.sellers.id))
      .where(eq(schema.settlements.queryId, queryId));

    return { query, responses, settlements };
  }, null);
}

export interface SellerWithStats extends schema.Seller {
  earnings: EarningsBreakdown;
  accuracy: number | null;
}

/** All sellers with computed earnings + accuracy, ranked by reputation. */
export function listSellers(): Promise<SellerWithStats[]> {
  return safe(async () => {
    const db = getDb();
    const sellers = await db
      .select()
      .from(schema.sellers)
      .orderBy(desc(schema.sellers.reputation), desc(schema.sellers.matched));
    const settlements = await db
      .select({
        sellerId: schema.settlements.sellerId,
        amount: schema.settlements.amount,
        status: schema.settlements.status,
      })
      .from(schema.settlements);

    const bySeller = new Map<string, { amount: string; status: string }[]>();
    for (const s of settlements) {
      const list = bySeller.get(s.sellerId) ?? [];
      list.push({ amount: s.amount, status: s.status });
      bySeller.set(s.sellerId, list);
    }
    return sellers.map((s) => ({
      ...s,
      earnings: aggregateEarnings(bySeller.get(s.id) ?? []),
      accuracy: accuracyPct(s.matched, s.served),
    }));
  }, []);
}

export interface SellerRoundRow {
  queryId: string;
  value: string;
  matched: boolean | null;
  latencyMs: number;
  truth: string | null;
  createdAt: Date;
}
export interface SellerDetail {
  seller: schema.Seller;
  earnings: EarningsBreakdown;
  accuracy: number | null;
  rounds: SellerRoundRow[];
}

/** One seller's detail: earnings, accuracy, and recent rounds. */
export function getSeller(id: string): Promise<SellerDetail | null> {
  return safe(async () => {
    const db = getDb();
    const [seller] = await db
      .select()
      .from(schema.sellers)
      .where(eq(schema.sellers.id, id));
    if (!seller) return null;

    const settlements = await db
      .select({
        amount: schema.settlements.amount,
        status: schema.settlements.status,
      })
      .from(schema.settlements)
      .where(eq(schema.settlements.sellerId, id));

    const rounds = await db
      .select({
        queryId: schema.responses.queryId,
        value: schema.responses.valueOrHash,
        matched: schema.responses.matched,
        latencyMs: schema.responses.latencyMs,
        truth: schema.queries.truth,
        createdAt: schema.queries.createdAt,
      })
      .from(schema.responses)
      .innerJoin(schema.queries, eq(schema.responses.queryId, schema.queries.id))
      .where(eq(schema.responses.sellerId, id))
      .orderBy(desc(schema.queries.createdAt))
      .limit(50);

    return {
      seller,
      earnings: aggregateEarnings(settlements),
      accuracy: accuracyPct(seller.matched, seller.served),
      rounds,
    };
  }, null);
}
