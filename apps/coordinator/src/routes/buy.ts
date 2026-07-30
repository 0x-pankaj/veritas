import { randomBytes } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { eq } from "drizzle-orm";
import { CATEGORIES, PROTOCOL, TESTNET, type Eip3009Authorization } from "@veritas/core";
import { getDb } from "../db.js";
import { queries, responses, sellers, settlements } from "../db/schema.js";
import { pickSellers } from "../services/registry.js";
import { fanout, quorumMet } from "../services/fanout.js";
import { runNumericRound } from "../services/verifier.js";
import { QuoteStore, computeFee, maxExposure } from "../services/quotes.js";
import type { SettlementItem, SettlementProvider } from "../services/settlement.js";
import type { VeritasClient } from "@veritas/onchain";

export interface BuyDeps {
  settlement: SettlementProvider;
  veritasClient: () => VeritasClient; // lazy — not every route needs Solana
  coordinatorApiKey: string;
  feeBps: number;
  feeAddress: string;
  quotes?: QuoteStore;
}

const quoteSchema = z.object({
  category: z.enum(CATEGORIES),
  symbol: z.string().min(1),
  k: z.number().int().min(PROTOCOL.MIN_K).max(PROTOCOL.MAX_K).default(3),
});

const authSchema = z.object({
  from: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  to: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  value: z.string().regex(/^\d+$/),
  validAfter: z.number().int(),
  validBefore: z.number().int(),
  nonce: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  signature: z.string().min(1),
});

const buySchema = z.object({
  quoteId: z.string().uuid(),
  authorizations: z.array(authSchema).min(PROTOCOL.MIN_K),
});

export function buildBuyRoutes(deps: BuyDeps) {
  const quotes = deps.quotes ?? new QuoteStore();

  return new Hono()
    .post("/quote", zValidator("json", quoteSchema), async (c) => {
      const { category, symbol, k } = c.req.valid("json");
      const sellers = await pickSellers(getDb(), category, symbol, k);
      if (sellers.length < PROTOCOL.MIN_K) {
        return c.json(
          { error: "not enough sellers for this category/symbol" as const },
          409,
        );
      }
      const prices = sellers.map((s) => s.price);
      const fee = computeFee(prices, deps.feeBps);
      const quote = quotes.create({
        category,
        symbol,
        k: sellers.length,
        sellers,
        fee,
        feeAddress: deps.feeAddress,
        maxExposure: maxExposure(prices, fee),
        network: TESTNET.arc.caip2,
      });
      return c.json({
        quoteId: quote.quoteId,
        candidates: sellers.map((s) => ({
          sellerId: s.id,
          payoutAddress: s.payoutAddress,
          price: s.price,
        })),
        fee,
        feeAddress: deps.feeAddress,
        maxExposure: quote.maxExposure,
        network: quote.network,
        expiresAt: quote.expiresAt,
      });
    })

    .post("/buy", zValidator("json", buySchema), async (c) => {
      const { quoteId, authorizations } = c.req.valid("json");
      const quote = quotes.take(quoteId);
      if (!quote) return c.json({ error: "unknown or expired quote" as const }, 410);

      // Match each candidate to exactly one auth (exact recipient + amount).
      const items: SettlementItem[] = [];
      for (const s of quote.sellers) {
        const auth = authorizations.find(
          (a) =>
            a.to.toLowerCase() === s.payoutAddress.toLowerCase() &&
            a.value === s.price,
        );
        if (!auth) {
          return c.json(
            { error: `missing authorization for seller ${s.id}` as const },
            400,
          );
        }
        items.push({
          authorization: auth as Eip3009Authorization,
          payTo: s.payoutAddress,
          amount: s.price,
          network: quote.network,
        });
      }
      let feeItem: SettlementItem | undefined;
      if (BigInt(quote.fee) > 0n) {
        const feeAuth = authorizations.find(
          (a) =>
            a.to.toLowerCase() === quote.feeAddress.toLowerCase() &&
            a.value === quote.fee,
        );
        if (!feeAuth) return c.json({ error: "missing fee authorization" as const }, 400);
        feeItem = {
          authorization: feeAuth as Eip3009Authorization,
          payTo: quote.feeAddress,
          amount: quote.fee,
          network: quote.network,
        };
      }

      // Validate ALL auths BEFORE fan-out — closes the free-oracle hole.
      const toVerify = feeItem ? [...items, feeItem] : items;
      const valid = await deps.settlement.verifyAll(toVerify);
      if (valid.some((v) => !v)) {
        return c.json({ error: "invalid or underfunded authorization" as const }, 402);
      }

      const db = getDb();
      const queryIdHex = randomBytes(32).toString("hex");
      const buyer = items[0]!.authorization.from;
      await db.insert(queries).values({
        id: queryIdHex,
        buyer,
        mode: "CONSENSUS",
        k: quote.k,
        feeAmount: quote.fee,
        status: "FANOUT",
      });

      // Fan out — sellers verify our credential; they never see each other.
      const results = await fanout(
        { queryId: queryIdHex, category: quote.category as never, symbol: quote.symbol },
        quote.sellers,
        { coordinatorApiKey: deps.coordinatorApiKey },
      );
      if (!quorumMet(results.length, quote.k)) {
        await db
          .update(queries)
          .set({ status: "FAILED" })
          .where(eq(queries.id, queryIdHex));
        // Nothing was redeemed — the agent owes 0 (pay-after-verdict).
        return c.json({ error: "quorum not met; nothing charged" as const }, 502);
      }
      await db.insert(responses).values(
        results.map((r) => ({
          queryId: queryIdHex,
          sellerId: r.seller.id,
          valueOrHash: r.value,
          latencyMs: r.latencyMs,
          signature: r.sig,
        })),
      );

      // Prove on Solana (the agent's critical path ends when we respond).
      const verdict = await runNumericRound({
        client: deps.veritasClient(),
        db,
        queryIdHex,
        results,
      });

      // Redeem ONLY winners (+ fee) — async, off the critical path.
      const winnerItems = items.filter((item) =>
        verdict.winners.some(
          (w) => w.seller.payoutAddress.toLowerCase() === item.payTo.toLowerCase(),
        ),
      );
      const toSettle = feeItem ? [...winnerItems, feeItem] : winnerItems;
      const winnersTotal = winnerItems
        .reduce((acc, w) => acc + BigInt(w.amount), 0n)
        .toString();
      const finalCost = (BigInt(winnersTotal) + BigInt(quote.fee)).toString();
      void deps.settlement
        .settleAll(toSettle)
        .then(async (receipts) => {
          for (const [i, receipt] of receipts.entries()) {
            const item = toSettle[i]!;
            const seller = quote.sellers.find(
              (s) => s.payoutAddress.toLowerCase() === item.payTo.toLowerCase(),
            );
            if (!seller) continue; // fee item
            await db.insert(settlements).values({
              queryId: queryIdHex,
              sellerId: seller.id,
              amount: item.amount,
              gatewayTx: receipt.txId || null,
              status: receipt.status === "PENDING" ? "PENDING" : "FAILED",
            });
          }
          await db
            .update(queries)
            .set({ status: "DONE", cost: finalCost })
            .where(eq(queries.id, queryIdHex));
        })
        .catch((err) => console.error("settlement failed", queryIdHex, err));

      return c.json({
        queryId: queryIdHex,
        data: {
          truth: verdict.truth,
          payloads: verdict.winners.map((w) => w.payload),
        },
        verdict: {
          truth: verdict.truth,
          winners: verdict.winners.map((w) => w.seller.id),
          outliers: verdict.outliers.map((o) => o.seller.id),
          solanaTx: verdict.solanaTx,
          requestPda: verdict.requestPda,
        },
        finalCost,
      });
    })

    .get("/verify/:queryId", async (c) => {
      const queryId = c.req.param("queryId");
      const db = getDb();
      const [q] = await db.select().from(queries).where(eq(queries.id, queryId));
      if (!q) return c.json({ error: "unknown query" as const }, 404);
      const [resRows, setRows] = await Promise.all([
        db
          .select({
            sellerId: responses.sellerId,
            name: sellers.name,
            solanaPubkey: sellers.solanaPubkey,
            valueOrHash: responses.valueOrHash,
            matched: responses.matched,
            latencyMs: responses.latencyMs,
            signature: responses.signature,
          })
          .from(responses)
          .innerJoin(sellers, eq(responses.sellerId, sellers.id))
          .where(eq(responses.queryId, queryId)),
        db
          .select({
            sellerId: settlements.sellerId,
            name: sellers.name,
            amount: settlements.amount,
            status: settlements.status,
            gatewayTx: settlements.gatewayTx,
          })
          .from(settlements)
          .innerJoin(sellers, eq(settlements.sellerId, sellers.id))
          .where(eq(settlements.queryId, queryId)),
      ]);
      return c.json({
        queryId: q.id,
        status: q.status,
        truth: q.truth,
        k: q.k,
        cost: q.cost,
        buyer: q.buyer,
        solanaTx: q.solanaTx,
        requestPda: q.solanaReqPda,
        responses: resRows,
        settlements: setRows,
      });
    });
}
