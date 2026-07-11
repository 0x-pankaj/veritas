import { hc } from "hono/client";
import type { AppType } from "@veritas/coordinator";
import type {
  SellerRoundRow,
  SellerStats,
  VerdictListItem,
} from "@veritas/coordinator/services/explorer";

export type { SellerRoundRow, SellerStats, VerdictListItem };

/** Coordinator base URL, read at call time so hosts can set it per-request. */
function client() {
  const base = process.env.VERITAS_FACILITATOR_URL ?? "http://localhost:3001";
  return hc<AppType>(base);
}

/** Never let a coordinator hiccup crash a page — log and fall back. */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error("[dashboard] coordinator error:", err);
    return fallback;
  }
}

/** Recent verdicts for the truth-ledger explorer, newest first. */
export function listVerdicts(limit = 25): Promise<VerdictListItem[]> {
  return safe(async () => {
    const res = await client().explorer.verdicts.$get({
      query: { limit: String(limit) },
    });
    if (res.status !== 200) throw new Error(`verdicts ${res.status}`);
    return (await res.json()).verdicts;
  }, []);
}

/** All sellers with earnings + accuracy, ranked by reputation. */
export function listSellers(): Promise<SellerStats[]> {
  return safe(async () => {
    const res = await client().explorer.sellers.$get();
    if (res.status !== 200) throw new Error(`sellers ${res.status}`);
    return (await res.json()).sellers;
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
  query: {
    id: string;
    truth: string | null;
    k: number;
    cost: string | null;
    status: string;
    buyer: string;
    solanaTx: string | null;
    solanaReqPda: string | null;
  };
  responses: VerdictResponse[];
  settlements: VerdictSettlement[];
}

/** A single verdict: the round, each seller's answer, and who got paid. */
export function getVerdict(queryId: string): Promise<VerdictDetail | null> {
  return safe(async () => {
    const res = await client().verify[":queryId"].$get({ param: { queryId } });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`verify ${res.status}`);
    const v = await res.json();
    return {
      query: {
        id: v.queryId,
        truth: v.truth,
        k: v.k,
        cost: v.cost,
        status: v.status,
        buyer: v.buyer,
        solanaTx: v.solanaTx,
        solanaReqPda: v.requestPda,
      },
      responses: v.responses.map((r) => ({
        sellerId: r.sellerId,
        name: r.name,
        value: r.valueOrHash,
        matched: r.matched,
        latencyMs: r.latencyMs,
      })),
      settlements: v.settlements,
    };
  }, null);
}

export interface SellerDetail {
  seller: SellerStats;
  earnings: SellerStats["earnings"];
  accuracy: number | null;
  rounds: SellerRoundRow[];
}

/** One seller's detail: stats, earnings, accuracy, and recent rounds. */
export function getSeller(id: string): Promise<SellerDetail | null> {
  return safe(async () => {
    const res = await client().explorer.sellers[":id"].$get({ param: { id } });
    if (res.status === 404) return null;
    if (res.status !== 200) throw new Error(`seller ${res.status}`);
    const { seller, rounds } = await res.json();
    return { seller, earnings: seller.earnings, accuracy: seller.accuracy, rounds };
  }, null);
}
