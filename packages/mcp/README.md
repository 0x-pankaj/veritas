# @veritas/mcp

The Veritas MCP server. Gives any MCP agent — Claude Code, Claude Desktop, or
any client — the ability to **buy verified data**: fan out to K independent
sellers, verify their agreement on Solana, and pay only the ones that matched
the truth. Liars earn nothing; you only pay for correct data.

## Tools

### `buy_verified_data`
Consensus purchase. Returns the verified answer, the on-chain verdict, and the
actual cost.

```
input:  { category, symbol, query?, mode?: "fast"|"verified", k?, maxPrice? }
output: { data, verdict: { truth, winners[], outliers[], solanaTx }, proof, cost }
```

- `category` — from the fixed taxonomy (`crypto-prices`, `prediction-markets`,
  `sports-odds`, `weather`, `onchain-analytics`).
- `symbol` — the coverage key sellers are matched on, e.g. `"BTC/USD"`.
- `maxPrice` — budget cap on total exposure (winners + fee), USDC base units.
  Required unless `VERITAS_MAX_PRICE` is set. The buy aborts before signing if
  the quote exceeds it.
- `mode` — `verified` (K-seller consensus, default) or `fast` (single-seller,
  reputation-routed). Fast mode is not yet wired in the coordinator MVP.

### `list_available_data`
Browse the catalog before buying.

```
input:  { category?, symbol? }
output: { listings: [{ id, name, price, category, coverage, schemaDesc, freshnessSec, reputation }] }
```

## Configuration

Environment variables:

| Var | Required | Meaning |
|---|---|---|
| `VERITAS_FACILITATOR_URL` | yes | Coordinator base URL |
| `VERITAS_BUYER_ADDRESS` | no | Buyer EVM address (a dev key is minted if absent) |
| `VERITAS_MAX_PRICE` | no | Default budget cap (USDC base units) |

> **MVP note:** the server signs with `LocalEip3009Signer` (structurally-valid
> authorizations for the mock settlement path). Production swaps in a Circle
> `@circle-fin/x402-batching` buyer signer — the server code is unchanged.

## Install in Claude Code

```jsonc
// .mcp.json (or claude mcp add)
{
  "mcpServers": {
    "veritas": {
      "command": "veritas-mcp",
      "env": {
        "VERITAS_FACILITATOR_URL": "http://localhost:3001",
        "VERITAS_MAX_PRICE": "20000"
      }
    }
  }
}
```

Or run from the monorepo without installing the bin:

```bash
VERITAS_FACILITATOR_URL=http://localhost:3001 \
  node packages/mcp/dist/index.js
```

Then ask your agent: *"list available crypto-price data, then buy the verified
BTC/USD price."*
