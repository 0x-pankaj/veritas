import { Hono } from "hono";

export const healthRoute = new Hono().get("/health", (c) =>
  c.json({ ok: true as const, service: "veritas-coordinator" as const }),
);
