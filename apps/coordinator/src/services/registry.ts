import { and, arrayContains, desc, eq, ne } from "drizzle-orm";
import type { Db } from "../db.js";
import { sellers, type Seller } from "../db/schema.js";

export interface RegisterSellerInput {
  solanaPubkey: string;
  payoutAddress: string;
  name: string;
  endpoint: string;
  price: string;
  mode: "CONSENSUS" | "CONTENT_ADDRESSED";
  category: string;
  coverage: string[];
  schemaDesc: string;
  freshnessSec: number;
}

/** Upsert a seller registration (idempotent on solanaPubkey). */
export async function registerSeller(
  db: Db,
  input: RegisterSellerInput,
): Promise<Seller> {
  // One endpoint = one live seller. A registration with a new identity at an
  // endpoint supersedes whoever held it (e.g. an ephemeral-key deploy that was
  // re-keyed): the old row is suspended, not deleted — its responses and
  // settlements remain auditable. Without this, stale rows at a live endpoint
  // would pass the health probe and occupy discovery slots forever.
  await db
    .update(sellers)
    .set({ status: "SUSPENDED" })
    .where(
      and(
        eq(sellers.endpoint, input.endpoint),
        ne(sellers.solanaPubkey, input.solanaPubkey),
      ),
    );
  const [row] = await db
    .insert(sellers)
    .values(input)
    .onConflictDoUpdate({
      target: sellers.solanaPubkey,
      set: {
        payoutAddress: input.payoutAddress,
        name: input.name,
        endpoint: input.endpoint,
        price: input.price,
        mode: input.mode,
        category: input.category,
        coverage: input.coverage,
        schemaDesc: input.schemaDesc,
        freshnessSec: input.freshnessSec,
        // Re-registering reclaims an endpoint a newer identity had taken.
        status: "ACTIVE",
      },
    })
    .returning();
  return row!;
}

export interface DiscoveryFilter {
  category?: string | undefined;
  symbol?: string | undefined;
}

/** Discovery: active sellers matching category/coverage, best reputation first. */
export async function listSellers(db: Db, filter: DiscoveryFilter): Promise<Seller[]> {
  return db
    .select()
    .from(sellers)
    .where(
      and(
        eq(sellers.status, "ACTIVE"),
        filter.category ? eq(sellers.category, filter.category) : undefined,
        filter.symbol ? arrayContains(sellers.coverage, [filter.symbol]) : undefined,
      ),
    )
    .orderBy(desc(sellers.reputation), desc(sellers.matched));
}

/**
 * Endpoint liveness probe. `GET /veritas/402` is mounted by every seller
 * middleware adapter and needs no credential — ANY HTTP response within the
 * timeout counts as alive; only connect failures/timeouts mark a seller dead.
 */
export async function probeSeller(endpoint: string, timeoutMs = 1500): Promise<boolean> {
  try {
    await fetch(`${endpoint}/veritas/402`, { signal: AbortSignal.timeout(timeoutMs) });
    return true;
  } catch {
    return false;
  }
}

/**
 * Select K sellers for a consensus round: top-reputation active sellers
 * covering the symbol, skipping dead endpoints (stale registrations with tied
 * reputation would otherwise occupy candidate slots and break quorum). All
 * candidates are probed concurrently; reputation order is preserved among the
 * healthy. Simple matching — no semantic search (PRODUCT §7.3).
 */
export async function pickSellers(
  db: Db,
  category: string,
  symbol: string,
  k: number,
  opts: { probe?: (endpoint: string) => Promise<boolean> } = {},
): Promise<Seller[]> {
  const candidates = await listSellers(db, { category, symbol });
  const probe = opts.probe ?? probeSeller;
  const alive = await Promise.all(candidates.map((c) => probe(c.endpoint)));
  return candidates.filter((_, i) => alive[i]).slice(0, k);
}
