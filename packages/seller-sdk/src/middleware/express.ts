import express, { type Router } from "express";
import {
  SERVE_PATH,
  build402,
  handleServe,
  type SellerMiddlewareOpts,
} from "./core.js";

/**
 * Express adapter (PRODUCT §3.2). Mount with `app.use(veritasSeller(opts))`.
 * Adds:
 *  - `POST /veritas/serve` — the coordinator fan-out endpoint (credential-gated).
 *  - `GET  /veritas/402`   — x402 payment requirements for direct/proxy callers.
 * All other routes pass through untouched, so existing handlers keep working.
 */
export function veritasSeller(opts: SellerMiddlewareOpts): Router {
  const router = express.Router();
  router.post(SERVE_PATH, express.json(), async (req, res) => {
    const outcome = await handleServe(
      opts,
      req.header("x-veritas-coordinator") ?? undefined,
      req.body as unknown,
    );
    res.status(outcome.status).json(outcome.body);
  });
  router.get("/veritas/402", (_req, res) => {
    const outcome = build402(opts);
    res.status(outcome.status).json(outcome.body);
  });
  return router;
}
