import { TESTNET, type UsdcAmount } from "@veritas/core";

/**
 * Minimal Circle Gateway balance view. Production wires this to
 * `GatewayClient` (`@circle-fin/x402-batching` — `.deposit`, `.getBalances`);
 * the agent never custodies funds, it only checks/tops up its own Gateway
 * balance (PRODUCT §4.1, Appendix B).
 */
export interface GatewayAdapter {
  /** Available USDC (6-decimal base units) for `address` on Arc. */
  getBalance(address: string): Promise<UsdcAmount>;
  /** Deposit `amount` USDC into the Gateway balance (one-time funding). */
  deposit?(amount: UsdcAmount): Promise<void>;
}

/**
 * Reads the buyer's Arc Gateway balance from the Circle testnet balances API.
 * Read-only — depositing requires the signed Circle deposit flow, which the
 * production `GatewayAdapter` provides.
 */
export class TestnetGatewayReader implements GatewayAdapter {
  constructor(
    private readonly domain: number = TESTNET.arc.gatewayDomain,
    private readonly api: string = TESTNET.circle.gatewayApi,
  ) {}

  async getBalance(address: string): Promise<UsdcAmount> {
    const res = await fetch(`${this.api}/v1/balances`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token: "USDC",
        sources: [{ domain: this.domain, depositor: address }],
      }),
    });
    if (!res.ok) throw new Error(`Gateway balances API ${res.status}`);
    const body = (await res.json()) as { balances?: { balance?: string }[] };
    return body.balances?.[0]?.balance ?? "0";
  }
}
