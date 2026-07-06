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

## Quickstart

```sh
pnpm install
cp .env.example .env   # fill in keys
pnpm -w typecheck && pnpm -w test
```

Requires Node ≥ 22, pnpm ≥ 10; Rust + Anchor + Solana CLI for `programs/`.
