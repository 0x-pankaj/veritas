import { randomUUID } from "node:crypto";
import type { Seller } from "../generated/prisma/client.js";

export interface StoredQuote {
  quoteId: string;
  category: string;
  symbol: string;
  k: number;
  sellers: Seller[];
  fee: string; // USDC base units
  feeAddress: string;
  maxExposure: string;
  network: string;
  expiresAt: number;
}

/**
 * In-memory quote store with TTL. MVP: single coordinator instance holds
 * in-flight round state (BUILD_PLAN deployment ruling); move to Postgres/Redis
 * when scaling horizontally.
 */
export class QuoteStore {
  private quotes = new Map<string, StoredQuote>();
  constructor(private ttlMs = 120_000) {}

  create(input: Omit<StoredQuote, "quoteId" | "expiresAt">): StoredQuote {
    const quote: StoredQuote = {
      ...input,
      quoteId: randomUUID(),
      expiresAt: Date.now() + this.ttlMs,
    };
    this.quotes.set(quote.quoteId, quote);
    return quote;
  }

  /** Take (consume) a quote — single use. Returns undefined if missing/expired. */
  take(quoteId: string): StoredQuote | undefined {
    const q = this.quotes.get(quoteId);
    if (!q) return undefined;
    this.quotes.delete(quoteId);
    return q.expiresAt > Date.now() ? q : undefined;
  }
}

export function computeFee(prices: string[], feeBps: number): string {
  const sum = prices.reduce((acc, p) => acc + BigInt(p), 0n);
  return ((sum * BigInt(feeBps)) / 10_000n).toString();
}

export function maxExposure(prices: string[], fee: string): string {
  return (prices.reduce((acc, p) => acc + BigInt(p), 0n) + BigInt(fee)).toString();
}
