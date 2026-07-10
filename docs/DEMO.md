# Veritas — 2-minute demo script

> The one moment that sells Veritas: **an AI agent buys a price, one seller lies,
> consensus catches the lie on Solana, and the liar earns nothing** — while a
> naive x402 buyer pays for the poisoned number.

This script is reproducible against Solana Devnet + a local Postgres, with Circle
settlement mocked (`MOCK_SETTLE=true`). The verified verdict is real and on-chain.

---

## What you need

- Node ≥ 22, pnpm ≥ 10; `pnpm install` done.
- A Postgres reachable at `DATABASE_URL` with the coordinator migrations applied
  (`cd apps/coordinator && pnpm exec drizzle-kit migrate`).
- A Devnet keypair with some SOL, exported as `DEVNET_KEYPAIR` (the JSON byte
  array) — used to fund + register the demo sellers. This is also the
  coordinator authority (`SOLANA_KEYPAIR`) that the program was initialized with.
- `.env` filled in (see `.env.example`). Key values for the demo:
  - `COORDINATOR_PORT=3001`, `COORDINATOR_API_KEY=<any shared secret>`
  - `MOCK_SETTLE=true`, `VERITAS_FEE_BPS=200`, `VERITAS_FEE_ADDRESS=0x…`
  - `SOLANA_RPC=…devnet…`, `SOLANA_KEYPAIR=<devnet coordinator key>`
  - `VERITAS_FACILITATOR_URL=http://localhost:3001`

---

## Bring up the stack (4 terminals)

```sh
# 1) Coordinator (Hono facilitator: fan-out, Solana writer, settlement)
pnpm --filter @veritas/coordinator dev
#   → veritas-coordinator listening on :3001 (settle=mock)

# 2) The three demo sellers (2 honest + 1 liar), funded + registered on Devnet
DEVNET_KEYPAIR=$(cat ~/.config/solana/id.json) \
COORDINATOR_API_KEY=<same as .env> \
VERITAS_FACILITATOR_URL=http://localhost:3001 \
  pnpm --filter @veritas/demo sellers:register
#   → Registered honest / honest2 / liar … serving

# 3) The live demo app (verified vs naive x402, side by side)
VERITAS_FACILITATOR_URL=http://localhost:3001 \
  pnpm --filter @veritas/demo dev        # → http://localhost:3002

# 4) The dashboard + truth-ledger explorer
pnpm --filter @veritas/dashboard dev     # → http://localhost:3003
```

> No Devnet/DB handy? The demo app still renders: it falls back to a canned
> result (`DEMO_MOCK=1` forces it), so the UI is always presentable.

---

## The narration (≈ 2 minutes)

**0:00 — The problem.** "Agents are starting to buy data from strangers and act
on it. But payment rails prove you *paid* — they never prove the data was
*true*. Here's an agent that needs the BTC/USD price. Three sellers answer. One
lies."

**0:20 — Buy verified.** Open `http://localhost:3002`. Click **Buy verified
BTC/USD price**. Two columns fill in:

- **Veritas verified** (right): three sellers answered — `acme-prices` $50,000,
  `globex-feed` $50,100, `sketchy-oracle` $55,000. The verdict computed *on
  Solana* marks the two honest sellers **matched** and the liar an **outlier**.
  The consensus truth is **$50,100**. Winners are paid in USDC on Arc; the liar
  earns **$0**.
- **Naive x402** (left): trusts one seller and pays on delivery — it accepts the
  poisoned **$55,000** and pays for it. "This is what every payment-only rail
  does today."

**0:50 — It's real, and it's auditable.** Note the **Solana tx** on the result.
Open the explorer at `http://localhost:3003`: the new verdict is in the truth
ledger. Click it — you see each seller's answer, who matched, who was the
outlier, the winners' settlement, and the on-chain signature. Anyone can audit
that settlement matched the verdict.

**1:20 — Accuracy is monetized.** From the explorer, open `sketchy-oracle`: its
reputation dropped and it earned nothing this round. Open `acme-prices`: matched,
paid, reputation up. "Honesty is the dominant strategy — a liar earns nothing and
loses reputation, so the market cleans itself. That public truth/reputation graph
on Solana is the moat."

**1:45 — The pitch in one line.** "Circle built the money rail — gasless sub-cent
USDC. Veritas is the thin verification gate between an agent's intent to pay and a
seller getting paid, so agents only pay for data that is provably correct."

---

## Maps to the product claims

| Claim (PRODUCT.md / pitch) | Where you see it in the demo |
|---|---|
| Consensus purchase catches liars | Verified column: liar flagged outlier |
| Verdict is on-chain + auditable | Solana tx on the result + explorer verdict page |
| Pay only for correct data | Liar earns $0; only winners settle |
| Naive x402 is unsafe | Left column pays for the poisoned $55,000 |
| Accuracy → reputation → demand | Seller pages: reputation + earnings move |
| Money settles on Arc, truth on Solana | Winners paid in USDC (mock) vs. verdict on Devnet |

---

## One-command proof (no UI)

The whole path is covered by an automated end-to-end test — register sellers →
agent `buy(verified)` → verdict on Solana → settle winners → dashboard reflects
it:

```sh
DEVNET_KEYPAIR=$(cat ~/.config/solana/id.json) pnpm --filter @veritas/e2e test
```
