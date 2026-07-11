import { GatewayClient, type SupportedChainName } from "@circle-fin/x402-batching/client";
import { formatUnits } from "viem";
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

export interface CircleGatewayAdapterOpts {
  /** Gateway-supported chain name; defaults to Arc Testnet. */
  chain?: SupportedChainName;
  /** Custom EVM RPC (Arc Testnet has a public default). */
  rpcUrl?: string;
}

/**
 * Full Gateway adapter over the buyer's OWN key (`GatewayClient` from
 * `@circle-fin/x402-batching`): reads the unified balance and performs the
 * real approve+deposit flow into the GatewayWallet contract. On Arc, gas is
 * paid in native USDC — the faucet grant covers both gas and the deposit.
 * Non-custodial: funds move only between the buyer's wallet and the buyer's
 * own Gateway balance (Appendix B — Veritas never holds buyer USDC).
 */
export class CircleGatewayAdapter implements GatewayAdapter {
  private readonly client: GatewayClient;
  /** Buyer EVM address derived from the private key. */
  readonly address: string;

  constructor(privateKey: `0x${string}`, opts: CircleGatewayAdapterOpts = {}) {
    this.client = new GatewayClient({
      chain: opts.chain ?? "arcTestnet",
      privateKey,
      ...(opts.rpcUrl ? { rpcUrl: opts.rpcUrl } : {}),
    });
    this.address = this.client.address;
  }

  /** Available Gateway USDC (base units) for `address`. */
  async getBalance(address: string): Promise<UsdcAmount> {
    const balances = await this.client.getBalances(address as `0x${string}`);
    return balances.gateway.available.toString();
  }

  /** Deposit `amount` base units of wallet USDC into the Gateway balance. */
  async deposit(amount: UsdcAmount): Promise<void> {
    await this.client.deposit(formatUnits(BigInt(amount), 6));
  }
}

/**
 * Reads the buyer's Arc Gateway balance from the Circle testnet balances API.
 * Read-only — depositing requires the signed Circle deposit flow, which
 * `CircleGatewayAdapter` provides.
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
