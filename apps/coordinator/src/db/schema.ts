/**
 * Veritas off-chain mirror (PRODUCT.md §8), Drizzle schema. On-chain is the
 * source of truth for verdicts/reputation/stake; this DB is a fast
 * read/analytics mirror plus coordination state (rounds, settlements).
 *
 * Enum string values intentionally match the previous Prisma enums.
 */
import { randomUUID } from "node:crypto";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const sellerStatus = pgEnum("seller_status", ["ACTIVE", "SUSPENDED"]);
export const verifyMode = pgEnum("verify_mode", [
  "CONSENSUS",
  "CONTENT_ADDRESSED",
  "REPUTATION",
]);
export const queryStatus = pgEnum("query_status", [
  "QUOTED",
  "FANOUT",
  "SETTLED_ONCHAIN", // verdict recorded on Solana
  "FAILED", // no consensus / quorum abort
  "DONE", // winners' settlement submitted
]);
export const settlementStatus = pgEnum("settlement_status", [
  "PENDING", // submitted to Gateway, TEE-credited
  "AVAILABLE", // batch-settled on Arc
  "FAILED",
]);

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => randomUUID());

export const sellers = pgTable(
  "sellers",
  {
    id: id(),
    solanaPubkey: text("solana_pubkey").notNull().unique(),
    payoutAddress: text("payout_address").notNull(), // EVM address for Gateway
    name: text("name").notNull(),
    endpoint: text("endpoint").notNull(),
    price: text("price").notNull(), // USDC base units per call
    mode: verifyMode("mode").notNull().default("CONSENSUS"),
    // capability descriptor (PRODUCT §7.3)
    category: text("category").notNull(),
    coverage: text("coverage").array().notNull(), // e.g. ["BTC/USD"]
    schemaDesc: text("schema_desc").notNull(),
    freshnessSec: integer("freshness_sec").notNull(),
    // reputation mirror (source of truth on-chain)
    reputation: integer("reputation").notNull().default(500),
    stake: text("stake").notNull().default("0"),
    served: integer("served").notNull().default(0),
    matched: integer("matched").notNull().default(0),
    outliers: integer("outliers").notNull().default(0),
    status: sellerStatus("status").notNull().default("ACTIVE"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("sellers_category_status_idx").on(t.category, t.status)],
);

export const queries = pgTable(
  "queries",
  {
    id: text("id").primaryKey(), // hex query id (32 bytes)
    buyer: text("buyer").notNull(), // buyer EVM address
    mode: verifyMode("mode").notNull(),
    k: integer("k").notNull(),
    maxPrice: text("max_price"),
    feeAmount: text("fee_amount").notNull().default("0"),
    truth: text("truth"), // consensus truth (decimal string or hash)
    cost: text("cost"), // final settled cost
    status: queryStatus("status").notNull().default("QUOTED"),
    solanaReqPda: text("solana_req_pda"),
    solanaTx: text("solana_tx"), // finalize_consensus signature
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("queries_status_created_idx").on(t.status, t.createdAt)],
);

export const responses = pgTable(
  "responses",
  {
    id: id(),
    queryId: text("query_id")
      .notNull()
      .references(() => queries.id),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id),
    valueOrHash: text("value_or_hash").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    matched: boolean("matched"),
    // ed25519 signature (0x-hex) of responseSigMessage(queryId, valueOrHash)
    // by the seller's Solana identity key; verified on ingest, republished on
    // /verify so third parties can re-check authorship. Null = legacy unsigned.
    signature: text("signature"),
  },
  (t) => [uniqueIndex("responses_query_seller_uq").on(t.queryId, t.sellerId)],
);

export const settlements = pgTable(
  "settlements",
  {
    id: id(),
    queryId: text("query_id")
      .notNull()
      .references(() => queries.id),
    sellerId: text("seller_id")
      .notNull()
      .references(() => sellers.id),
    amount: text("amount").notNull(), // USDC base units
    gatewayTx: text("gateway_tx"),
    status: settlementStatus("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => [index("settlements_status_idx").on(t.status)],
);

export type Seller = typeof sellers.$inferSelect;
export type NewSeller = typeof sellers.$inferInsert;
export type Query = typeof queries.$inferSelect;
export type Response = typeof responses.$inferSelect;
export type Settlement = typeof settlements.$inferSelect;
