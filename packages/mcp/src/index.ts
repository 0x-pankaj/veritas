#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { Veritas, LocalEip3009Signer } from "@veritas/agent";
import { createVeritasMcpServer } from "./server.js";

export { createVeritasMcpServer } from "./server.js";
export type { VeritasMcpOpts, VeritasLike } from "./server.js";

/**
 * Stdio entry point (the `veritas-mcp` bin). Reads config from the environment:
 *   VERITAS_FACILITATOR_URL  coordinator base URL (required)
 *   VERITAS_BUYER_ADDRESS    buyer EVM address (optional; a dev key is minted)
 *   VERITAS_MAX_PRICE        default budget cap, USDC base units (optional)
 *
 * MVP uses LocalEip3009Signer (structurally-valid auths for the mock
 * settlement path). Production swaps in a Circle x402-batching buyer signer —
 * the server code is unchanged.
 */
async function main(): Promise<void> {
  const facilitatorUrl = process.env.VERITAS_FACILITATOR_URL;
  if (!facilitatorUrl) {
    console.error("VERITAS_FACILITATOR_URL is required");
    process.exit(1);
  }
  const veritas = new Veritas({
    facilitatorUrl,
    signer: new LocalEip3009Signer(process.env.VERITAS_BUYER_ADDRESS),
  });
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
