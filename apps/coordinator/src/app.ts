import { Hono } from "hono";
import { healthRoute } from "./routes/health.js";
import { sellersRoute } from "./routes/sellers.js";
import { explorerRoute } from "./routes/explorer.js";
import { buildBuyRoutes, type BuyDeps } from "./routes/buy.js";

/**
 * The coordinator app. ALL routes must be chained/composed here so the
 * exported AppType carries full request/response types — the agent SDK
 * consumes this via `hono/client`, making API drift a compile error
 * (BUILD_PLAN P2-T1; the reason Hono was chosen).
 */
export function buildApp(deps: BuyDeps) {
  return new Hono()
    .route("/", healthRoute)
    .route("/", sellersRoute)
    .route("/", explorerRoute)
    .route("/", buildBuyRoutes(deps));
}

export type AppType = ReturnType<typeof buildApp>;
export type { BuyDeps };
