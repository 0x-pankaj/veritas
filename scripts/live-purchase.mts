/**
 * Drive one REAL verified purchase against a deployed Veritas coordinator.
 *
 * Unlike `tests/e2e`, this does NOT boot its own sellers — it buys from the
 * sellers already registered with the target coordinator, so their on-chain
 * reputation and the public truth ledger actually move. This is what turns a
 * freshly deployed stack (`served=0`, empty explorer) into something a reviewer
 * can inspect.
 *
 *   pnpm purchase                          # buys from the deployed coordinator
 *   pnpm purchase http://localhost:3001    # or any coordinator you point it at
 *
 * Env:
 *   ARC_PRIVATE_KEY          buyer EOA (required for real settlement — Gateway
 *                            recovers the signer with ecrecover, so it must be
 *                            an EOA, not a contract wallet). Fund it at
 *                            https://faucet.circle.com (token USDC, network Arc
 *                            Testnet); USDC is also Arc's gas token.
 *   VERITAS_FACILITATOR_URL  coordinator to buy from (defaults to the deployed one)
 *   VERITAS_SYMBOL           coverage key to buy (default BTC/USD)
 *   VERITAS_CATEGORY         category to buy (default crypto-prices)
 *   VERITAS_K                fan-out width (default 3)
 *   VERITAS_MAX_PRICE        client-side budget cap, USDC base units (default 20000)
 *
 * Exit codes: 0 = purchase verified, 1 = failed.
 */
import { resolve } from "node:path";

try {
  process.loadEnvFile(resolve(import.meta.dirname, "../.env"));
} catch {
  /* rely on ambient env */
}

import {
  CircleEip3009Signer,
  CircleGatewayAdapter,
  Veritas,
} from "@veritas/agent";
import { verifyResponseSig, type Category } from "@veritas/core";

// Precedence: CLI arg > VERITAS_FACILITATOR_URL > the deployed coordinator.
// The arg matters because a local .env normally points VERITAS_FACILITATOR_URL
// at localhost for development — pass the URL explicitly to buy from prod.
const DEPLOYED = "https://coordinator-production-b0e4.up.railway.app";
const FACILITATOR =
  process.argv[2] ?? process.env.VERITAS_FACILITATOR_URL ?? DEPLOYED;
const SYMBOL = process.env.VERITAS_SYMBOL ?? "BTC/USD";
const CATEGORY = (process.env.VERITAS_CATEGORY ?? "crypto-prices") as Category;
const K = Number(process.env.VERITAS_K ?? 3);
const MAX_PRICE = process.env.VERITAS_MAX_PRICE ?? "20000";

const arcKey = process.env.ARC_PRIVATE_KEY as `0x${string}` | undefined;
if (!arcKey) {
  console.error(
    "ARC_PRIVATE_KEY is required — a real purchase needs real EIP-3009\n" +
      "authorizations. Put a funded testnet EOA key in .env, or claim USDC at\n" +
      "https://faucet.circle.com (token USDC, network Arc Testnet).",
  );
  process.exit(1);
}

const usdc = (base: string | number) =>
  `$${(Number(base) / 1e6).toFixed(6).replace(/0+$/, "").replace(/\.$/, "")}`;

console.log(`Veritas live purchase`);
console.log(`  coordinator  ${FACILITATOR}`);
console.log(`  buying       ${CATEGORY} ${SYMBOL}  (k=${K}, cap ${usdc(MAX_PRICE)})`);

const gateway = new CircleGatewayAdapter(arcKey);
const veritas = new Veritas({
  facilitatorUrl: FACILITATOR,
  signer: new CircleEip3009Signer(arcKey),
  gateway,
});

console.log(`  buyer        ${gateway.address}`);

// 1. Who is actually serving this symbol right now?
const catalog = await veritas.listAvailableData({ symbol: SYMBOL });
if (catalog.length === 0) {
  console.error(
    `\nNo sellers registered for ${SYMBOL} on this coordinator. Is the sellers\n` +
      `service running and registered? Check GET ${FACILITATOR}/sellers`,
  );
  process.exit(1);
}
console.log(`\nSellers offering ${SYMBOL}:`);
for (const s of catalog) {
  console.log(
    `  ${s.name.padEnd(16)} ${usdc(s.price).padEnd(10)} reputation=${s.reputation}`,
  );
}

// 2. Make sure the buyer has Gateway balance to cover the worst case.
//    ensureDeposit is a no-op when the balance already suffices.
console.log(`\nChecking Gateway balance…`);
const before = await gateway.getBalance(gateway.address);
console.log(`  available    ${usdc(before)}`);
if (BigInt(before) < BigInt(MAX_PRICE)) {
  console.log(`  depositing up to ${usdc(MAX_PRICE)} (approve + deposit on Arc)…`);
}
await veritas.ensureDeposit(MAX_PRICE);

// 3. The purchase. K+1 exact-amount authorizations are signed, the coordinator
//    verifies every signature and the aggregate balance BEFORE any seller is
//    asked for data, and only the winners' authorizations are ever redeemed.
console.log(`\nBuying…`);
const started = Date.now();
const bought = await veritas.buy({
  category: CATEGORY,
  symbol: SYMBOL,
  mode: "verified",
  k: K,
  maxPrice: MAX_PRICE,
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

console.log(`\n─── verdict ───────────────────────────────────────────`);
console.log(`  consensus truth   ${bought.verdict.truth}`);
console.log(`  query id          ${bought.queryId}`);
console.log(`  paid              ${usdc(bought.finalCost)}  (cap was ${usdc(MAX_PRICE)})`);
console.log(`  took              ${elapsed}s`);
if (bought.verdict.solanaTx) {
  console.log(`  solana tx         ${bought.verdict.solanaTx}`);
  console.log(
    `  explorer          https://solscan.io/tx/${bought.verdict.solanaTx}?cluster=devnet`,
  );
}

// 4. Who answered what, who matched, who got paid. Settlement is async, so
//    poll /verify briefly for the settlement rows + Gateway transfer ids.
let audit = await veritas.verify(bought.queryId);
for (let i = 0; i < 24 && audit.settlements.length === 0; i++) {
  await new Promise((r) => setTimeout(r, 500));
  audit = await veritas.verify(bought.queryId);
}

const nameById = new Map(catalog.map((s) => [s.id, s.name]));
const paidById = new Map(audit.settlements.map((s) => [s.sellerId, s]));

// Re-verify every seller signature LOCALLY — ed25519 over
// (queryId, value) against the seller's on-chain Solana identity. This is
// the point of signed responses: you do not have to trust the coordinator's
// record of who said what.
type AuditResponse = (typeof audit.responses)[number] & {
  signature?: string | null;
  solanaPubkey?: string;
};
const sigState = (r: AuditResponse): "valid" | "INVALID" | "unsigned" => {
  if (!r.signature) return "unsigned";
  return verifyResponseSig(r.signature, bought.queryId, r.valueOrHash, r.solanaPubkey ?? "")
    ? "valid"
    : "INVALID";
};

console.log(`\n─── who answered ──────────────────────────────────────`);
for (const r of audit.responses as AuditResponse[]) {
  const paid = paidById.get(r.sellerId);
  console.log(
    `  ${(nameById.get(r.sellerId) ?? r.sellerId).padEnd(16)}` +
      `${String(r.valueOrHash).padEnd(12)}` +
      `${r.matched ? "matched " : "OUTLIER "}` +
      `${(paid ? `paid ${usdc(paid.amount)}` : "paid $0").padEnd(14)}` +
      `sig ${sigState(r)}`,
  );
}

console.log(`\n─── settlement (Circle Gateway, Arc Testnet) ──────────`);
if (audit.settlements.length === 0) {
  console.log(`  no settlement rows yet — redemption is async; re-check /verify`);
} else {
  for (const s of audit.settlements) {
    console.log(
      `  ${(nameById.get(s.sellerId) ?? s.sellerId).padEnd(16)}` +
        `${usdc(s.amount).padEnd(10)}${s.status.padEnd(10)}${s.gatewayTx ?? ""}`,
    );
  }
  console.log(
    `\n  Verify any of these yourself — Circle's transfers API needs no auth:\n` +
      `    curl https://gateway-api-testnet.circle.com/v1/x402/transfers/<id>`,
  );
  console.log(
    `  Rows stay PENDING until Circle batch-settles on Arc (~1.5-2h on the\n` +
      `  quiet testnet), then the coordinator's reconciler flips them AVAILABLE.`,
  );
}

// 5. Sanity assertions — this is a proof, so it should fail loudly.
const winners = audit.responses.filter((r) => r.matched);
const losers = audit.responses.filter((r) => !r.matched);
let ok = true;

if (winners.length === 0) {
  console.error(`\nFAIL: no seller matched consensus`);
  ok = false;
}
if (BigInt(bought.finalCost) > BigInt(MAX_PRICE)) {
  console.error(`\nFAIL: paid ${bought.finalCost} > cap ${MAX_PRICE}`);
  ok = false;
}
for (const l of losers) {
  if (paidById.has(l.sellerId)) {
    console.error(
      `\nFAIL: outlier ${nameById.get(l.sellerId) ?? l.sellerId} was paid`,
    );
    ok = false;
  }
}
for (const r of audit.responses as AuditResponse[]) {
  if (sigState(r) === "INVALID") {
    console.error(
      `\nFAIL: recorded response for ${nameById.get(r.sellerId) ?? r.sellerId} ` +
        `does not verify against its Solana identity — the record was altered`,
    );
    ok = false;
  }
}

console.log(
  `\n${ok ? "✓" : "✗"} ${winners.length} matched, ${losers.length} outlier(s) earned $0. ` +
    `Verdict is on Solana Devnet; the ledger now has a real entry.`,
);
process.exit(ok ? 0 : 1);
