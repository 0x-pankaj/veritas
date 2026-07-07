import type { PrismaClient, Seller } from "../generated/prisma/client.js";

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
  db: PrismaClient,
  input: RegisterSellerInput,
): Promise<Seller> {
  return db.seller.upsert({
    where: { solanaPubkey: input.solanaPubkey },
    create: input,
    update: {
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
  });
}

export interface DiscoveryFilter {
  category?: string | undefined;
  symbol?: string | undefined;
}

/** Discovery: active sellers matching category/coverage, best reputation first. */
export async function listSellers(
  db: PrismaClient,
  filter: DiscoveryFilter,
): Promise<Seller[]> {
  return db.seller.findMany({
    where: {
      status: "ACTIVE",
      ...(filter.category ? { category: filter.category } : {}),
      ...(filter.symbol ? { coverage: { has: filter.symbol } } : {}),
    },
    orderBy: [{ reputation: "desc" }, { matched: "desc" }],
  });
}

/**
 * Select K sellers for a consensus round: top-reputation active sellers
 * covering the symbol. Simple matching — no semantic search (PRODUCT §7.3).
 */
export async function pickSellers(
  db: PrismaClient,
  category: string,
  symbol: string,
  k: number,
): Promise<Seller[]> {
  const candidates = await listSellers(db, { category, symbol });
  return candidates.slice(0, k);
}
