/**
 * One-time Devnet config initialization (BUILD_PLAN P1-T6).
 * Usage: pnpm dlx tsx scripts/init-devnet.ts
 */
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import { VeritasClient } from "@veritas/onchain";

const DEVNET_USDC = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

async function main() {
  const payer = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(readFileSync(`${homedir()}/.config/solana/id.json`, "utf8"))),
  );
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const client = new VeritasClient({ connection, payer });

  try {
    const existing = await client.getConfig();
    console.log("Config already initialized:");
    console.log("  coordinator:", existing.coordinator.toBase58());
    console.log("  stake mint :", existing.stakeMint.toBase58());
    return;
  } catch {
    // not initialized yet — proceed
  }

  const sig = await client.initialize({
    coordinator: payer.publicKey,
    stakeMint: DEVNET_USDC,
    feeBps: 200,
    toleranceBps: 100,
  });
  console.log("Initialized. tx:", sig);
  const config = await client.getConfig();
  console.log("  admin      :", config.admin.toBase58());
  console.log("  coordinator:", config.coordinator.toBase58());
  console.log("  stake mint :", config.stakeMint.toBase58());
  console.log("  fee_bps    :", config.feeBps, " tolerance_bps:", config.toleranceBps);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
