#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CircleEip3009Signer,
  CircleGatewayAdapter,
  LocalEip3009Signer,
  Veritas,
} from "@veritas/agent";
import { createVeritasMcpServer } from "./server.js";

export { createVeritasMcpServer } from "./server.js";
export type { VeritasMcpOpts, VeritasLike } from "./server.js";

/**
 * Stdio entry point (the `veritas-mcp` bin). Reads config from the environment:
 *   VERITAS_FACILITATOR_URL  coordinator base URL (required)
 *   ARC_PRIVATE_KEY          buyer EOA key — when set, purchases sign REAL
 *                            EIP-3009 authorizations and settle real USDC on
 *                            Arc (fund at faucet.circle.com)
 *   VERITAS_BUYER_ADDRESS    buyer EVM address for the dev signer (optional;
 *                            only used when ARC_PRIVATE_KEY is absent)
 *   VERITAS_MAX_PRICE        default budget cap, USDC base units (optional)
 *
 * Without ARC_PRIVATE_KEY the server falls back to LocalEip3009Signer:
 * structurally-valid auths for a mock-settlement coordinator (dev only).
 */
async function main(): Promise<void> {
  const facilitatorUrl = process.env.VERITAS_FACILITATOR_URL;
  if (!facilitatorUrl) {
    console.error("VERITAS_FACILITATOR_URL is required");
    process.exit(1);
  }
  const arcKey = process.env.ARC_PRIVATE_KEY as `0x${string}` | undefined;
  const veritas = new Veritas(
    arcKey
      ? {
          facilitatorUrl,
          signer: new CircleEip3009Signer(arcKey),
          gateway: new CircleGatewayAdapter(arcKey),
        }
      : {
          facilitatorUrl,
          signer: new LocalEip3009Signer(process.env.VERITAS_BUYER_ADDRESS),
        },
  );
  const server = createVeritasMcpServer({
    veritas,
    ...(process.env.VERITAS_MAX_PRICE
      ? { defaultMaxPrice: process.env.VERITAS_MAX_PRICE }
      : {}),
  });
  await server.connect(new StdioServerTransport());
}

// Run only when invoked directly (not when imported for its exports).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
