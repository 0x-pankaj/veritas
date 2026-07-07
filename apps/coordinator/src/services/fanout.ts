import type { FanoutRequest, FanoutResponse } from "@veritas/core";
import type { Seller } from "../db/schema.js";

export interface FanoutResult {
  seller: Seller;
  value: string;
  payload: unknown;
  latencyMs: number;
}

export interface FanoutOpts {
  /** Per-seller timeout (ms). */
  timeoutMs?: number;
  /** Credential sellers verify before serving (MVP auth, PRODUCT §7.1). */
  coordinatorApiKey: string;
}

const DEFAULT_TIMEOUT_MS = 3_000;

/**
 * Query K sellers concurrently. Failures/timeouts are dropped, not fatal —
 * the caller enforces quorum. Sellers never see each other's answers.
 */
export async function fanout(
  request: FanoutRequest,
  sellers: Seller[],
  opts: FanoutOpts,
): Promise<FanoutResult[]> {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const attempts = sellers.map(async (seller): Promise<FanoutResult | null> => {
    const started = Date.now();
    try {
      const res = await fetch(new URL("/veritas/serve", seller.endpoint), {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-veritas-coordinator": opts.coordinatorApiKey,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as FanoutResponse;
      if (typeof body.value !== "string" || body.value.length === 0) return null;
      return {
        seller,
        value: body.value,
        payload: body.payload ?? null,
        latencyMs: Date.now() - started,
      };
    } catch {
      return null; // timeout / network / bad JSON — dropped, quorum decides
    }
  });

  const settled = await Promise.all(attempts);
  return settled.filter((r): r is FanoutResult => r !== null);
}

/** Quorum: ceil(k * ratio) of the k queried sellers must respond. */
export function quorumMet(responded: number, k: number, ratio = 2 / 3): boolean {
  return responded >= Math.ceil(k * ratio);
}
