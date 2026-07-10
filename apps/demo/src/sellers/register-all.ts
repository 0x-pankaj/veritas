import {
  Connection,
  Keypair,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { registerRunningSeller, startSeller, type RunningSeller } from "./run-seller.js";
import type { Role } from "./definitions.js";

/**
 * One-command demo setup: start all three sellers, fund their Solana
 * identities from the payer (DEVNET_KEYPAIR) if needed, register them on
 * Devnet + the coordinator, then keep serving. Requires a running coordinator
 * (VERITAS_FACILITATOR_URL) and DEVNET_KEYPAIR with some Devnet SOL.
 */
const DEVNET = process.env.DEVNET_KEYPAIR;
if (!DEVNET) {
  console.error("DEVNET_KEYPAIR is required (JSON byte array with Devnet SOL)");
  process.exit(1);
}

const ROLES: Role[] = ["honest", "honest2", "liar"];
const RENT_LAMPORTS = 20_000_000; // enough for the SellerAccount PDA + fees

const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(DEVNET)));
const connection = new Connection(
  process.env.SOLANA_RPC ?? "https://api.devnet.solana.com",
  "confirmed",
);

const running: RunningSeller[] = [];
for (const role of ROLES) running.push(await startSeller(role));

// Fund any seller identity that is short on SOL.
const underfunded = new Transaction();
let needFunding = false;
for (const r of running) {
  const bal = await connection.getBalance(r.seller.keypair.publicKey);
  if (bal < RENT_LAMPORTS) {
    needFunding = true;
    underfunded.add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: r.seller.keypair.publicKey,
        lamports: RENT_LAMPORTS,
      }),
    );
  }
}
if (needFunding) {
  await sendAndConfirmTransaction(connection, underfunded, [payer], {
    commitment: "confirmed",
  });
  console.log("Funded seller identities.");
}

for (const r of running) {
  await registerRunningSeller(r);
  console.log(
    `Registered ${r.role.padEnd(8)} ${r.seller.name.padEnd(16)} id=${r.seller.id} at ${r.url}`,
  );
}
console.log("All demo sellers registered + serving. Ctrl-C to stop.");
