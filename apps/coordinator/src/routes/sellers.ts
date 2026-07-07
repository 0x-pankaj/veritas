import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { CATEGORIES } from "@veritas/core";
import { getDb } from "../db.js";
import { listSellers, registerSeller } from "../services/registry.js";

const registerSchema = z.object({
  solanaPubkey: z.string().min(32).max(44),
  payoutAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/, "EVM address"),
  name: z.string().min(1).max(32),
  endpoint: z.string().url(),
  price: z.string().regex(/^\d+$/, "USDC base units"),
  mode: z.enum(["CONSENSUS", "CONTENT_ADDRESSED"]).default("CONSENSUS"),
  category: z.enum(CATEGORIES),
  coverage: z.array(z.string().min(1)).min(1).max(100),
  schemaDesc: z.string().min(1).max(500),
  freshnessSec: z.number().int().positive().max(86_400),
});

const listQuerySchema = z.object({
  category: z.enum(CATEGORIES).optional(),
  symbol: z.string().optional(),
});

export const sellersRoute = new Hono()
  .post("/sellers/register", zValidator("json", registerSchema), async (c) => {
    const input = c.req.valid("json");
    const seller = await registerSeller(getDb(), input);
    return c.json(
      {
        id: seller.id,
        solanaPubkey: seller.solanaPubkey,
        reputation: seller.reputation,
        status: seller.status,
      },
      201,
    );
  })
  .get("/sellers", zValidator("query", listQuerySchema), async (c) => {
    const filter = c.req.valid("query");
    const sellers = await listSellers(getDb(), filter);
    return c.json({
      sellers: sellers.map((s) => ({
        id: s.id,
        solanaPubkey: s.solanaPubkey,
        name: s.name,
        price: s.price,
        mode: s.mode,
        category: s.category,
        coverage: s.coverage,
        schemaDesc: s.schemaDesc,
        freshnessSec: s.freshnessSec,
        reputation: s.reputation,
        served: s.served,
        matched: s.matched,
        outliers: s.outliers,
      })),
    });
  });
