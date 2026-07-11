import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import { getDb } from "../db.js";
import { getSellerDetail, listSellerStats, listVerdicts } from "../services/explorer.js";

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).default(25),
});

/**
 * Read-only explorer API for the dashboard (PRODUCT §8). Keeps ALL DB access
 * behind the coordinator so the dashboard is a thin, stateless HTTP client
 * (deployable to any edge/static host). Consumed via `hono/client` typed RPC.
 */
export const explorerRoute = new Hono()
  .get("/explorer/verdicts", zValidator("query", listQuerySchema), async (c) => {
    const { limit } = c.req.valid("query");
    return c.json({ verdicts: await listVerdicts(getDb(), limit) });
  })
  .get("/explorer/sellers", async (c) => {
    return c.json({ sellers: await listSellerStats(getDb()) });
  })
  .get("/explorer/sellers/:id", async (c) => {
    const detail = await getSellerDetail(getDb(), c.req.param("id"));
    if (!detail) return c.json({ error: "unknown seller" as const }, 404);
    return c.json(detail);
  });
