import { z } from "zod";
import type { UsdcAmount } from "./types.js";

/**
 * x402 payment-requirements payload Veritas sellers return with a 402 status.
 * Carries the Nanopayments scheme plus Veritas verification metadata.
 */
export interface X402PaymentRequirements {
  scheme: "exact";
  network: string;
  /** Seller's declared price — MUST equal the on-chain registry price. */
  maxAmountRequired: UsdcAmount;
  payTo: string;
  asset: string;
  /** Veritas extension. */
  extra: {
    veritas: {
      version: 1;
      sellerId: string;
      mode: "consensus" | "content-addressed";
      /** Present in content-addressed mode: keccak256 of the payload to be delivered. */
      commitment?: string;
    };
  };
}

export const x402RequirementsSchema = z.object({
  scheme: z.literal("exact"),
  network: z.string(),
  maxAmountRequired: z.string().regex(/^\d+$/),
  payTo: z.string(),
  asset: z.string(),
  extra: z.object({
    veritas: z.object({
      version: z.literal(1),
      sellerId: z.string(),
      mode: z.enum(["consensus", "content-addressed"]),
      commitment: z.string().optional(),
    }),
  }),
});

export function build402Body(req: X402PaymentRequirements): {
  x402Version: number;
  accepts: X402PaymentRequirements[];
} {
  return { x402Version: 1, accepts: [req] };
}

export function parse402Body(body: unknown): X402PaymentRequirements {
  const parsed = z
    .object({ x402Version: z.number(), accepts: z.array(x402RequirementsSchema).min(1) })
    .parse(body);
  return parsed.accepts[0] as X402PaymentRequirements;
}
