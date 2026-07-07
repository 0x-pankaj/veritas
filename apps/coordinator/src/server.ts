import { serve } from "@hono/node-server";
import { envSchema, loadEnv } from "@veritas/core";
import { buildApp } from "./app.js";

const env = loadEnv(envSchema.pick({ COORDINATOR_PORT: true }));
const app = buildApp();

serve({ fetch: app.fetch, port: env.COORDINATOR_PORT }, (info) => {
  console.log(`veritas-coordinator listening on :${info.port}`);
});
