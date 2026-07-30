# Buying verified data (agents & developers)

One call buys data that is **provably correct**: K independent sellers answer,
Solana computes the consensus verdict on-chain, and only the sellers that
matched the truth are paid — gaslessly, in USDC on Arc. If a seller lies, you
get the true value anyway and the liar gets nothing.

## Quickstart (real settlement, Arc Testnet)

Fund a testnet EOA at [faucet.circle.com](https://faucet.circle.com)
(token **USDC**, network **Arc Testnet**), then:

```ts
import { Veritas, CircleEip3009Signer, CircleGatewayAdapter } from "@veritas/agent";

const key = process.env.ARC_PRIVATE_KEY as `0x${string}`;
const veritas = new Veritas({
  facilitatorUrl: "https://coordinator-production-b0e4.up.railway.app",
  signer: new CircleEip3009Signer(key),
  gateway: new CircleGatewayAdapter(key),
});

await veritas.ensureDeposit("20000");        // top up Gateway balance if needed

const { data, verdict, finalCost, queryId } = await veritas.buy({
  category: "crypto-prices",
  symbol: "BTC/USD",
  mode: "verified",
  k: 3,
  maxPrice: "20000",                          // hard cap, USDC base units
});
```

- `data` — the consensus-verified value (+ winning sellers' payloads).
- `verdict` — truth, winners, outliers, and the **Solana tx** that proves it.
- `finalCost` — what you actually paid: winners + fee, never more than
  `maxPrice`.
- `queryId` — your receipt; feed it to `verify()` or the public `/verify` API.

The key must be an **EOA** (Gateway recovers the signer with `ecrecover`).

## What `buy()` does under the hood

1. **Quote** — the coordinator returns K reputation-ranked, health-probed
   sellers, the fee, and `maxExposure` (sum of prices + fee).
2. **Client-side budget check** — if `maxExposure > maxPrice`, it aborts
   *before signing anything*. You cannot overspend by construction.
3. **Sign** — one exact-amount, single-use EIP-3009 authorization per seller
   plus one for the fee. Each names an exact recipient and amount; none can be
   reused or altered.
4. **Buy** — the coordinator verifies every signature and your aggregate
   Gateway balance **before** any seller is asked for data, fans out, submits
   the answers to Solana, and finalizes the consensus verdict on-chain.
5. **Settle** — only the winners' (and fee) authorizations are redeemed. An
   outlier's authorization is never used.

Worst case you pay `maxExposure`; typical case is less (outliers aren't paid);
failure case (no quorum / no consensus) you pay **nothing** — pay-after-verdict.

## Auditing a purchase

```ts
const audit = await veritas.verify(queryId);
```

Or publicly, no SDK, no auth:

```sh
curl https://coordinator-production-b0e4.up.railway.app/verify/<queryId>
```

Every response row carries the seller's ed25519 **signature** and its Solana
**pubkey**. Re-verify authorship yourself — the coordinator's word is not
required:

```ts
import { verifyResponseSig } from "@veritas/core";

for (const r of audit.responses) {
  verifyResponseSig(r.signature!, queryId, r.valueOrHash, r.solanaPubkey); // → true
}
```

`pnpm purchase <coordinator-url>` (in this repo) runs a full purchase and does
this signature re-verification, plus payment checks against Circle's public
transfers API, in one command.

## For AI agents: the MCP server

Any MCP client — Claude Code, Claude Desktop, or your own agent loop — can buy
verified data natively through `@veritas/mcp`:

```jsonc
// .mcp.json / claude_desktop_config.json
{
  "mcpServers": {
    "veritas": {
      "command": "veritas-mcp",
      "env": {
        "VERITAS_FACILITATOR_URL": "https://coordinator-production-b0e4.up.railway.app",
        "ARC_PRIVATE_KEY": "0x…",        // funded testnet EOA → REAL settlement
        "VERITAS_MAX_PRICE": "20000"     // default budget cap per purchase
      }
    }
  }
}
```

Tools exposed:

- **`list_available_data`** — browse the catalog by category/coverage, ranked
  by on-chain reputation, before spending anything.
- **`buy_verified_data`** — consensus purchase; returns the verified answer,
  the verdict (winners/outliers/Solana tx), and the actual USDC cost.

Without `ARC_PRIVATE_KEY` the server falls back to a structural dev signer,
which only works against a mock-settlement coordinator — set the key for
anything real.

## Dev mode (no real money)

`LocalEip3009Signer` produces structurally-valid authorizations for a
coordinator running `MOCK_SETTLE=true` — the full protocol flow (quote, sign,
fan-out, verdict on Devnet) without Circle settlement. Use it in tests; the
`Veritas` call site is otherwise identical.

## Parameters reference

| `buy()` param | Meaning | Default |
|---|---|---|
| `category` | platform category (`crypto-prices`, `prediction-markets`, `sports-odds`, `weather`, `onchain-analytics`) | required |
| `symbol` | coverage key sellers are matched on, e.g. `"BTC/USD"` | required |
| `mode` | `"verified"` (K-seller consensus); `"fast"` (single-seller by reputation) is on the roadmap and currently throws | `"verified"` |
| `k` | consensus fan-out width (bounds: 3–7) | `3` |
| `maxPrice` | client-side cap on total exposure, USDC base units | required |
