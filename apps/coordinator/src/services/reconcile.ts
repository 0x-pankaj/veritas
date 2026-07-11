import { eq } from "drizzle-orm";
import type { Db } from "../db.js";
import { settlements } from "../db/schema.js";

export interface ReconcileConfig {
  /** Gateway API base URL, e.g. https://gateway-api-testnet.circle.com */
  gatewayApiUrl: string;
}

/** Gateway x402 transfer lifecycle (GET /v1/x402/transfers/:id). */
type TransferStatus = "received" | "batched" | "confirmed" | "completed" | "failed";

/**
 * Advance settlement rows by polling Gateway transfer status (BUILD_PLAN
 * P2-T6 polling fallback — testnet Gateway has no self-serve webhooks, and a
 * local coordinator isn't publicly reachable anyway). `gatewayTx` stores the
 * transfer id returned by settle. Mapping: the recipient's Gateway balance is
 * TEE-credited at settle time (row starts PENDING); `confirmed`/`completed`
 * means the batch landed on Arc → AVAILABLE; `failed` → FAILED;
 * `received`/`batched` stay PENDING.
 */
export async function reconcileSettlements(
  db: Db,
  config: ReconcileConfig,
): Promise<{ checked: number; updated: number }> {
  const pending = await db
    .select()
    .from(settlements)
    .where(eq(settlements.status, "PENDING"));

  let updated = 0;
  for (const row of pending) {
    if (!row.gatewayTx) continue;
    let status: TransferStatus | undefined;
    try {
      const res = await fetch(
        `${config.gatewayApiUrl}/v1/x402/transfers/${encodeURIComponent(row.gatewayTx)}`,
      );
      if (!res.ok) continue;
      status = ((await res.json()) as { status?: TransferStatus }).status;
    } catch {
      continue; // transient API failure — retry next tick
    }
    const next =
      status === "failed"
        ? ("FAILED" as const)
        : status === "confirmed" || status === "completed"
          ? ("AVAILABLE" as const)
          : undefined;
    if (next) {
      await db.update(settlements).set({ status: next }).where(eq(settlements.id, row.id));
      updated++;
    }
  }
  return { checked: pending.length, updated };
}

/** Start the polling loop (SETTLE_POLL_MS). Returns a stop function. */
export function startSettlementReconciler(
  db: Db,
  config: ReconcileConfig,
  intervalMs: number,
): () => void {
  const timer = setInterval(() => {
    reconcileSettlements(db, config).catch((err) =>
      console.warn("settlement reconciliation failed:", err),
    );
  }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
