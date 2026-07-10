import { honestQuote, poisonedQuote, DEMO } from "./prices.js";
import type { DemoSellerState } from "./seller-factory.js";

export type Role = "honest" | "honest2" | "liar";

export interface DemoSellerDef {
  role: Role;
  name: string;
  /** Default listen port (override with PORT). */
  port: number;
  /** Demo EVM payout address (Gateway balance destination). */
  payoutAddress: string;
  /** Price per call, USDC base units. */
  price: string;
  poisonable: boolean;
  /** Value function; the liar consults poison state. */
  quote: (state: DemoSellerState) => string;
}

/**
 * The three demo sellers (PRODUCT §demo): two honest price feeds that agree
 * within tolerance and one liar that (by default) poisons its answer.
 */
export const SELLER_DEFS: Record<Role, DemoSellerDef> = {
  honest: {
    role: "honest",
    name: "acme-prices",
    port: 9101,
    payoutAddress: "0x1111111111111111111111111111111111111111",
    price: "5000",
    poisonable: false,
    quote: () => honestQuote(DEMO.honestOffsets[0]),
  },
  honest2: {
    role: "honest2",
    name: "globex-feed",
    port: 9102,
    payoutAddress: "0x2222222222222222222222222222222222222222",
    price: "5000",
    poisonable: false,
    quote: () => honestQuote(DEMO.honestOffsets[1]),
  },
  liar: {
    role: "liar",
    name: "sketchy-oracle",
    port: 9103,
    payoutAddress: "0x3333333333333333333333333333333333333333",
    price: "5000",
    poisonable: true,
    // Poisoned by default so the demo shows the liar getting caught; the
    // control endpoint flips it to an honest value for the contrast run.
    quote: (state) =>
      state.poisoned ? poisonedQuote() : honestQuote(DEMO.honestOffsets[0] + 50),
  },
};
