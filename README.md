# Veritas

**The verification layer for the agent economy.** An AI agent buys data from
strangers and pays only for data that is provably correct — verified on Solana,
settled gaslessly in USDC via Circle Gateway Nanopayments on Arc.

## Layout

```
programs/veritas/   Anchor program — consensus verdicts, seller registry, reputation (Solana Devnet)
packages/core/      @veritas/core    shared types, constants, hashing, x402 helpers
packages/onchain/   @veritas/onchain typed Anchor client + PDA helpers
packages/seller-sdk @veritas/seller  5-line middleware for data sellers
packages/agent-sdk  @veritas/agent   one-call buyer SDK
packages/mcp/       @veritas/mcp     MCP server for LLM agents
apps/coordinator/   Hono facilitator — fan-out, verdicts, Circle settlement
apps/dashboard/     Next.js seller dashboard + public truth-ledger explorer
apps/demo/          the "liar caught by consensus" live demo
```

```
tests/e2e/          @veritas/e2e     full-system E2E (sellers → buy → verdict → settle → dashboard)
```

## Quickstart

```sh
pnpm install
cp .env.example .env   # fill in keys
pnpm -w typecheck && pnpm -w test
```

Requires Node ≥ 22, pnpm ≥ 10; Rust + Anchor + Solana CLI for `programs/`.

## See it work

The "liar caught by consensus" demo runs against Solana Devnet with Circle
settlement mocked. Full step-by-step in [`docs/DEMO.md`](docs/DEMO.md):

```sh
# coordinator + 3 sellers (2 honest, 1 liar) + demo UI + dashboard
pnpm --filter @veritas/coordinator dev                                  # :3001
DEVNET_KEYPAIR=$(cat ~/.config/solana/id.json) \
  pnpm --filter @veritas/demo sellers:register                          # registers sellers
pnpm --filter @veritas/demo dev                                         # :3002  the demo
pnpm --filter @veritas/dashboard dev                                    # :3003  explorer
```

One-command proof of the whole path (Devnet + Postgres):

```sh
DEVNET_KEYPAIR=$(cat ~/.config/solana/id.json) pnpm --filter @veritas/e2e test
```

## Deploy

Every service ships a monorepo-aware Dockerfile (coordinator, dashboard, demo,
sellers) with per-service Railway configs (`railway.*.json`). Full turnkey
runbook — project + Postgres + all services + public demo URL — in
[`docs/DEPLOY.md`](docs/DEPLOY.md).
