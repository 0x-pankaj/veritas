import express, { type Express } from "express";
import type { Keypair } from "@solana/web3.js";
import { veritasSeller, type Seller } from "@veritas/seller";
import { DEMO } from "./prices.js";

export interface DemoSellerOpts {
  name: string;
  keypair: Keypair;
  /** EVM address where won USDC settles into the seller's Gateway balance. */
  payoutAddress: string;
  /** Price per call, USDC 6-decimal base units. */
  price: string;
  /** Credential the coordinator presents on fan-out. */
  coordinatorApiKey: string;
  coordinatorUrl: string;
  /** Returns the current canonical numeric value (decimal string). The liar
   *  reads `state.poisoned` to decide honest vs. poisoned. */
  quote: (state: DemoSellerState) => string;
  /** If true, expose a control endpoint to toggle poisoning at runtime. */
  poisonable?: boolean;
}

/** Runtime state a demo seller exposes (for tests + the demo control panel). */
export interface DemoSellerState {
  /** Current poison flag (liar only). */
  poisoned: boolean;
}

export interface DemoSellerApp {
  app: Express;
  /** The middleware handle — endpoint is filled in once the server is listening. */
  seller: Seller;
  state: DemoSellerState;
}

/**
 * Build a demo price-feed seller: a real Express app wrapped with the
 * `@veritas/seller` middleware. Serves `{ value, payload }` on the
 * coordinator's fan-out endpoint (POST /veritas/serve). The liar variant adds
 * `POST /control/poison { on }` so the demo can flip it live (PRODUCT §demo).
 */
export function createDemoSellerApp(opts: DemoSellerOpts): DemoSellerApp {
  const state: DemoSellerState = { poisoned: opts.poisonable ?? false };

  const seller: Seller = {
    id: opts.keypair.publicKey.toBase58(), // stand-in until coordinator assigns
    name: opts.name,
    solanaPubkey: opts.keypair.publicKey.toBase58(),
    payoutAddress: opts.payoutAddress,
    endpoint: "", // set by the runner after listen()
    price: opts.price,
    mode: "consensus",
    capability: {
      category: DEMO.category,
      coverage: [DEMO.symbol],
      schema: "{ symbol, price, ts }",
      freshnessSec: 5,
    },
    coordinatorUrl: opts.coordinatorUrl,
    reputation: 500,
    status: "ACTIVE",
    keypair: opts.keypair,
  };

  const app = express();
  app.use(
    veritasSeller({
      seller,
      coordinatorApiKey: opts.coordinatorApiKey,
      serve: ({ symbol }) => {
        const value = opts.quote(state);
        return { value, payload: { symbol, price: value, ts: Date.now() } };
      },
    }),
  );

  // Health + identity (used by the demo UI and the runner).
  app.get("/health", (_req, res) => {
    res.json({ name: opts.name, poisoned: state.poisoned });
  });

  if (opts.poisonable) {
    app.post("/control/poison", express.json(), (req, res) => {
      const on = (req.body as { on?: unknown }).on;
      if (typeof on !== "boolean") {
        res.status(400).json({ error: "body must be { on: boolean }" });
        return;
      }
      state.poisoned = on;
      res.json({ poisoned: state.poisoned });
    });
  }

  return { app, seller, state };
}
