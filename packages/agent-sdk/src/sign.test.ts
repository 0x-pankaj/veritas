import { describe, expect, it } from "vitest";
import { recoverTypedDataAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { TESTNET } from "@veritas/core";
import { CircleEip3009Signer } from "./sign.js";

/** Well-known throwaway key (hardhat account #1) — never funded, test-only. */
const PK = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const PAY_TO = "0x1111111111111111111111111111111111111111";

const EIP3009_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

describe("CircleEip3009Signer", () => {
  it("signs a cryptographically-valid auth over the GatewayWalletBatched domain", async () => {
    const signer = new CircleEip3009Signer(PK);
    const account = privateKeyToAccount(PK);
    expect(signer.address).toBe(account.address);

    const auth = await signer.sign({
      to: PAY_TO,
      value: "5000",
      network: TESTNET.arc.caip2,
    });

    expect(auth.from).toBe(account.address);
    expect(auth.to.toLowerCase()).toBe(PAY_TO);
    expect(auth.value).toBe("5000");
    expect(auth.nonce).toMatch(/^0x[0-9a-f]{64}$/i);
    const now = Math.floor(Date.now() / 1000);
    expect(auth.validAfter).toBeLessThanOrEqual(now);
    // Gateway enforces a 7-day MINIMUM validity window (minValiditySeconds).
    expect(auth.validBefore).toBeGreaterThanOrEqual(now + 7 * 24 * 3600 - 60);

    // The signature must recover to the buyer over the exact domain Gateway
    // verifies: {GatewayWalletBatched, 1, Arc chainId, GatewayWallet contract}.
    const recovered = await recoverTypedDataAddress({
      domain: {
        name: "GatewayWalletBatched",
        version: "1",
        chainId: Number(TESTNET.arc.caip2.split(":")[1]),
        verifyingContract: TESTNET.arc.gatewayWallet,
      },
      types: EIP3009_TYPES,
      primaryType: "TransferWithAuthorization",
      message: {
        from: auth.from as `0x${string}`,
        to: auth.to as `0x${string}`,
        value: BigInt(auth.value),
        validAfter: BigInt(auth.validAfter),
        validBefore: BigInt(auth.validBefore),
        nonce: auth.nonce as `0x${string}`,
      },
      signature: auth.signature as `0x${string}`,
    });
    expect(recovered).toBe(account.address);
  });

  it("uses a fresh one-time nonce per auth", async () => {
    const signer = new CircleEip3009Signer(PK);
    const [a, b] = await Promise.all([
      signer.sign({ to: PAY_TO, value: "1", network: TESTNET.arc.caip2 }),
      signer.sign({ to: PAY_TO, value: "1", network: TESTNET.arc.caip2 }),
    ]);
    expect(a.nonce).not.toBe(b.nonce);
  });
});
