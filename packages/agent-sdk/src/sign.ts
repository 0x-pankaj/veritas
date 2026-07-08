import { randomBytes } from "node:crypto";
import { PROTOCOL, type Eip3009Authorization, type UsdcAmount } from "@veritas/core";

/** One authorization to sign: pay `to` exactly `value` on `network`. */
export interface AuthRequest {
  to: string;
  value: UsdcAmount;
  network: string;
}

/**
 * Signs EIP-3009 `TransferWithAuthorization` messages — one exact-amount,
 * one-time-nonce, short-expiry auth per recipient. Signing is offchain and
 * gasless; a signed auth is a capped conditional promise only redeemable
 * as-is by the named recipient (PRODUCT §2.2).
 */
export interface Eip3009Signer {
  /** Buyer EVM address — becomes the auth `from`. */
  readonly address: string;
  sign(req: AuthRequest): Promise<Eip3009Authorization>;
}

/**
 * Dev/test signer: emits structurally-valid auths (exact amount, random
 * 32-byte nonce, `validBefore` ≈ 10 min) with a placeholder signature. These
 * pass the coordinator's structural + nonce-replay checks (MockSettlement
 * Provider), so the full quote→buy→verdict flow runs without a live EVM
 * signer or funded Gateway balance.
 *
 * Production uses the Circle `@circle-fin/x402-batching` buyer flow with a
 * real EVM signer (viem/ethers) to produce cryptographically-valid EIP-3009
 * signatures the `CircleSettlementProvider` redeems on Arc. Same interface —
 * swap the implementation, the `Veritas` client is unchanged.
 */
export class LocalEip3009Signer implements Eip3009Signer {
  readonly address: string;

  constructor(address?: string) {
    this.address = address ?? `0x${randomBytes(20).toString("hex")}`;
  }

  async sign(req: AuthRequest): Promise<Eip3009Authorization> {
    const now = Math.floor(Date.now() / 1000);
    return {
      from: this.address,
      to: req.to,
      value: req.value,
      validAfter: now - 60,
      validBefore: now + Math.floor(PROTOCOL.AUTH_VALIDITY_MS / 1000),
      nonce: `0x${randomBytes(32).toString("hex")}`,
      signature: `0x${randomBytes(65).toString("hex")}`,
    };
  }
}
