import { randomBytes } from "node:crypto";
import {
  CIRCLE_BATCHING_NAME,
  CIRCLE_BATCHING_VERSION,
  GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
} from "@circle-fin/x402-batching";
import { BatchEvmScheme } from "@circle-fin/x402-batching/client";
import { privateKeyToAccount } from "viem/accounts";
import { PROTOCOL, TESTNET, type Eip3009Authorization, type UsdcAmount } from "@veritas/core";

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
export interface CircleEip3009SignerOpts {
  /** USDC token address for the settlement network (requirements.asset). */
  asset?: string;
  /** GatewayWallet contract — the EIP-712 verifyingContract Gateway redeems against. */
  verifyingContract?: string;
}

/**
 * Production signer: real EIP-3009 `TransferWithAuthorization` signatures via
 * the Circle Nanopayments buyer flow (`BatchEvmScheme`). Signs EIP-712 over
 * the domain `{GatewayWalletBatched, 1, chainId, GatewayWallet}` — the
 * GatewayWallet contract is the verifyingContract, NOT the USDC token — so
 * the auth is redeemable only through Circle Gateway batched settlement.
 *
 * Must be an EOA: Gateway recovers the signer with ecrecover (no ERC-1271),
 * and the recovered address must own the Gateway deposit being spent.
 *
 * Note: Gateway enforces a MINIMUM auth validity of 7 days
 * (`minValiditySeconds` in /v1/x402/supported), so `validBefore` is
 * ≈ now + 7 days — not the 10-minute window the mock signer uses. Exposure
 * is still bounded per-auth by the exact amount + one-time nonce.
 */
export class CircleEip3009Signer implements Eip3009Signer {
  readonly address: string;
  private readonly scheme: BatchEvmScheme;
  private readonly asset: string;
  private readonly verifyingContract: string;

  constructor(privateKey: `0x${string}`, opts: CircleEip3009SignerOpts = {}) {
    const account = privateKeyToAccount(privateKey);
    this.address = account.address;
    this.scheme = new BatchEvmScheme(account);
    this.asset = opts.asset ?? TESTNET.arc.usdc;
    this.verifyingContract = opts.verifyingContract ?? TESTNET.arc.gatewayWallet;
  }

  async sign(req: AuthRequest): Promise<Eip3009Authorization> {
    const { payload } = await this.scheme.createPaymentPayload(2, {
      scheme: "exact",
      network: req.network,
      asset: this.asset,
      amount: req.value,
      payTo: req.to,
      maxTimeoutSeconds: GATEWAY_AUTH_VALIDITY_WINDOW_SECONDS,
      extra: {
        name: CIRCLE_BATCHING_NAME,
        version: CIRCLE_BATCHING_VERSION,
        verifyingContract: this.verifyingContract,
      },
    });
    const a = payload.authorization;
    return {
      from: a.from,
      to: a.to,
      value: a.value,
      validAfter: Number(a.validAfter),
      validBefore: Number(a.validBefore),
      nonce: a.nonce,
      signature: payload.signature,
    };
  }
}

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
