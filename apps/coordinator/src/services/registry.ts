import { and, arrayContains, desc, eq } from "drizzle-orm";
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
 * Select K sellers for a consensus round: top-reputation active sellers
 * covering the symbol. Simple matching — no semantic search (PRODUCT §7.3).
 */
export async function pickSellers(
  db: Db,
  category: string,
  symbol: string,
  k: number,
): Promise<Seller[]> {
  const candidates = await listSellers(db, { category, symbol });
  return candidates.slice(0, k);
}
