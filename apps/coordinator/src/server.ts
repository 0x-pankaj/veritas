import { config } from "dotenv";
import { resolve } from "node:path";
// Load the repo-root .env in local dev; silently no-ops when absent (prod
// containers get env from the platform).
config({ path: resolve(import.meta.dirname, "../../../.env") });
config(); // also honor a cwd-local .env

import { serve } from "@hono/node-server";
import { Connection, Keypair } from "@solana/web3.js";
import { envSchema, loadEnv } from "@veritas/core";
import { VeritasClient } from "@veritas/onchain";
import { buildApp } from "./app.js";
import { getDb } from "./db.js";
import { makeSettlementProvider } from "./services/settlement.js";
import { startSettlementReconciler } from "./services/reconcile.js";

const env = loadEnv(
  envSchema.pick({
    COORDINATOR_PORT: true,
    COORDINATOR_API_KEY: true,
    MOCK_SETTLE: true,
    GATEWAY_API_URL: true,
    SETTLE_POLL_MS: true,
    VERITAS_FEE_BPS: true,
    VERITAS_FEE_ADDRESS: true,
    SOLANA_RPC: true,
    SOLANA_KEYPAIR: true,
  }),
);

let veritasClient: VeritasClient | undefined;

const app = buildApp({
  settlement: makeSettlementProvider(env.MOCK_SETTLE, {
    gatewayApiUrl: env.GATEWAY_API_URL,
  }),
  coordinatorApiKey: env.COORDINATOR_API_KEY,
  feeBps: env.VERITAS_FEE_BPS,
  feeAddress: env.VERITAS_FEE_ADDRESS,
  veritasClient: () => {
    veritasClient ??= new VeritasClient({
      connection: new Connection(env.SOLANA_RPC, "confirmed"),
      payer: Keypair.fromSecretKey(Uint8Array.from(JSON.parse(env.SOLANA_KEYPAIR))),
    });
    return veritasClient;
  },
});

if (!env.MOCK_SETTLE && env.SETTLE_POLL_MS > 0) {
  startSettlementReconciler(
    getDb(),
    { gatewayApiUrl: env.GATEWAY_API_URL },
    env.SETTLE_POLL_MS,
  );
}

serve({ fetch: app.fetch, port: env.COORDINATOR_PORT }, (info) => {
  console.log(
    `veritas-coordinator listening on :${info.port} (settle=${env.MOCK_SETTLE ? "mock" : "circle"}` +
      `${!env.MOCK_SETTLE && env.SETTLE_POLL_MS > 0 ? `, reconcile every ${env.SETTLE_POLL_MS}ms` : ""})`,
  );
});
