import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { registerSeller, type Seller } from "@veritas/seller";
import { createDemoSellerApp, type DemoSellerApp } from "./seller-factory.js";
import { loadOrCreateKeypair } from "./keys.js";
import { SELLER_DEFS, type Role } from "./definitions.js";

export const COORDINATOR_URL =
  process.env.VERITAS_FACILITATOR_URL ?? "http://localhost:3001";
export const COORDINATOR_API_KEY =
  process.env.COORDINATOR_API_KEY ?? "dev-coordinator-key";

export interface RunningSeller extends DemoSellerApp {
  role: Role;
  server: Server;
  url: string;
  port: number;
}

/**
 * Start a demo seller HTTP server. `port` 0 picks an ephemeral port (tests);
 * omit to use PORT or the role's default. Does NOT register — call
 * `registerRunningSeller` (needs a funded keypair + a running coordinator).
 */
export async function startSeller(role: Role, port?: number): Promise<RunningSeller> {
  const def = SELLER_DEFS[role];
  const keypair = loadOrCreateKeypair(role);
  const built = createDemoSellerApp({
    name: def.name,
    keypair,
    payoutAddress: def.payoutAddress,
    price: def.price,
    coordinatorApiKey: COORDINATOR_API_KEY,
    coordinatorUrl: COORDINATOR_URL,
    quote: def.quote,
    poisonable: def.poisonable,
  });
  const listenPort = port ?? Number(process.env.PORT ?? def.port);
  const server = await new Promise<Server>((res) => {
    const s = built.app.listen(listenPort, () => res(s));
  });
  const actualPort = (server.address() as AddressInfo).port;
  // SELLER_HOST lets a deployed seller register a network-reachable endpoint
  // (e.g. a Railway private host) instead of loopback. Defaults to localhost.
  const host = process.env.SELLER_HOST ?? "127.0.0.1";
  const url = `http://${host}:${actualPort}`;
  built.seller.endpoint = url;
  return { ...built, role, server, url, port: actualPort };
}

/**
 * Register a running seller on Solana Devnet + the coordinator registry
 * (creates the SellerAccount PDA if absent + upserts the capability row).
 * Requires the seller keypair to hold a little SOL for rent — the demo setup
 * (`register-all.ts`) funds them first.
 */
export async function registerRunningSeller(
  running: RunningSeller,
): Promise<Seller> {
  const def = SELLER_DEFS[running.role];
  const registered = await registerSeller({
    name: def.name,
    solanaKeypair: running.seller.keypair,
    payoutAddress: def.payoutAddress,
    endpoint: running.url,
    price: def.price,
    mode: "consensus",
    capability: running.seller.capability,
    coordinatorUrl: COORDINATOR_URL,
    ...(process.env.SOLANA_RPC ? { solanaRpc: process.env.SOLANA_RPC } : {}),
  });
  // Adopt the coordinator-assigned id/reputation on the live handle.
  running.seller.id = registered.id;
  running.seller.reputation = registered.reputation;
  running.seller.status = registered.status;
  return registered;
}

/** Stop a running seller. */
export function stopSeller(running: RunningSeller): void {
  running.server.close();
}
