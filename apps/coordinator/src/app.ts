import { Hono } from "hono";
import { healthRoute } from "./routes/health.js";

/**
 * The coordinator app. ALL routes must be chained/composed here so the
 * exported AppType carries full request/response types — the agent SDK
 * consumes this via `hono/client`, making API drift a compile error
 * (BUILD_PLAN P2-T1; the reason Hono was chosen).
 */
export function buildApp() {
  return new Hono().route("/", healthRoute);
}

export type AppType = ReturnType<typeof buildApp>;
