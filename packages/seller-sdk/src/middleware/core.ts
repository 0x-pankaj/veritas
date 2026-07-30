import { z } from "zod";
import {
  CATEGORIES,
  TESTNET,
  build402Body,
  commitment,
  signResponse,
  type FanoutRequest,
  type FanoutResponse,
  type UsdcAmount,
  type X402PaymentRequirements,
} from "@veritas/core";
import type { Seller, SellerMode } from "../types.js";

/**
 * Resolves the seller's data for one fan-out request. `value` is the
 * canonical comparable the coordinator submits on-chain (decimal string for
 * numeric consensus; the payload's hash is derived for content-addressed).
 * `payload` is the full response delivered to the buyer.
 */
export type ServeFn = (
  req: FanoutRequest,
) => Promise<FanoutResponse> | FanoutResponse;

export interface SellerMiddlewareOpts {
  /** Handle from `registerSeller` — supplies id, price, mode, payout, capability. */
  seller: Seller;
  /** Data resolver for `{ category, symbol }`. */
  serve: ServeFn;
  /**
   * Credential the coordinator presents on fan-out (`x-veritas-coordinator`).
   * Sellers never serve data to a caller without payment authority (PRODUCT §7.1).
   */
  coordinatorApiKey: string;
  /** Override the registered price (USDC base units). */
  price?: UsdcAmount;
  /** Override the registered mode. */
  mode?: SellerMode;
  /** CAIP-2 settlement network; defaults to Arc Testnet. */
  network?: string;
  /** USDC asset address; defaults to Arc Testnet USDC. */
  asset?: string;
}

/** Path the coordinator fan-out engine POSTs to (see coordinator fanout.ts). */
export const SERVE_PATH = "/veritas/serve";

const fanoutRequestSchema = z.object({
  queryId: z.string().min(1),
  category: z.enum(CATEGORIES),
  symbol: z.string().min(1),
});

export interface ServeOutcome {
  status: number;
  body: unknown;
}

function priceOf(opts: SellerMiddlewareOpts): UsdcAmount {
  return opts.price ?? opts.seller.price;
}
function modeOf(opts: SellerMiddlewareOpts): SellerMode {
  return opts.mode ?? opts.seller.mode;
}

/**
 * Framework-agnostic handler for a coordinator fan-out request. Adapters
 * (Express/Fastify/Next) parse their transport and delegate here.
 *
 * - Wrong/absent credential → 401 (never serves data without payment authority).
 * - Malformed body → 400.
 * - Otherwise runs `serve` and returns `{ value, payload }`; content-addressed
 *   mode attaches `commitment = keccak256(canonicalJson(payload))` so the buyer
 *   can check delivered bytes against it (PRODUCT §2.4).
 */
export async function handleServe(
  opts: SellerMiddlewareOpts,
  credential: string | undefined,
  rawBody: unknown,
): Promise<ServeOutcome> {
  if (credential !== opts.coordinatorApiKey) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const parsed = fanoutRequestSchema.safeParse(rawBody);
  if (!parsed.success) {
    return { status: 400, body: { error: "invalid fan-out request" } };
  }
  const result = await opts.serve(parsed.data);
  const body: FanoutResponse & { commitment?: string } = {
    value: result.value,
    payload: result.payload ?? null,
    // Signed with the seller's Solana identity key — the coordinator verifies
    // against the registered pubkey and republishes the signature on /verify,
    // so recorded answers are non-forgeable and third-party checkable.
    sig: signResponse(
      parsed.data.queryId,
      result.value,
      opts.seller.keypair.secretKey,
    ),
  };
  if (modeOf(opts) === "content-addressed") {
    body.commitment = commitment(body.payload);
  }
  return { status: 200, body };
}

/**
 * The x402 payment requirements a direct/proxy caller (Option C) gets on 402.
 * The declared price MUST equal the on-chain registry price — the coordinator
 * enforces this consistency check (PRODUCT §7.1).
 */
export function buildPaymentRequirements(
  opts: SellerMiddlewareOpts,
): X402PaymentRequirements {
  return {
    scheme: "exact",
    network: opts.network ?? TESTNET.arc.caip2,
    maxAmountRequired: priceOf(opts),
    payTo: opts.seller.payoutAddress,
    asset: opts.asset ?? TESTNET.arc.usdc,
    extra: {
      veritas: {
        version: 1,
        sellerId: opts.seller.id,
        mode: modeOf(opts),
      },
    },
  };
}

/** Full 402 response body (x402Version + accepts[]). */
export function build402(opts: SellerMiddlewareOpts): ServeOutcome {
  return { status: 402, body: build402Body(buildPaymentRequirements(opts)) };
}
