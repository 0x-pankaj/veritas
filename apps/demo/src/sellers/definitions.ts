import { honestQuote, poisonedQuote, DEMO } from "./prices.js";
import type { DemoSellerState } from "./seller-factory.js";

export type Role = "honest" | "honest2" | "liar";

export interface DemoSellerDef {
  role: Role;
  name: string;
  /** Default listen port (override with PORT). */
  port: number;
  /** Price per call, USDC base units. */
  price: string;
  poisonable: boolean;
  /** Value function; the liar consults poison state. */
  quote: (state: DemoSellerState) => string;
}

/**
 * The three demo sellers (PRODUCT §demo): two honest price feeds that agree
 * within tolerance and one liar that (by default) poisons its answer.
 * Payout addresses are not listed here — each is a real EOA derived from the
 * seller's Solana identity key (see `payoutAddressFor` in keys.ts).
 */
export const SELLER_DEFS: Record<Role, DemoSellerDef> = {
  honest: {
    role: "honest",
    name: "acme-prices",
    port: 9101,
    price: "5000",
    poisonable: false,
    quote: () => honestQuote(DEMO.honestOffsets[0]),
  },
  honest2: {
    role: "honest2",
    name: "globex-feed",
    port: 9102,
    price: "5000",
    poisonable: false,
    quote: () => honestQuote(DEMO.honestOffsets[1]),
  },
  liar: {
    role: "liar",
    name: "sketchy-oracle",
    port: 9103,
    price: "5000",
    poisonable: true,
    // Poisoned by default so the demo shows the liar getting caught; the
    // control endpoint flips it to an honest value for the contrast run.
    quote: (state) =>
      state.poisoned ? poisonedQuote() : honestQuote(DEMO.honestOffsets[0] + 50),
  },
};
