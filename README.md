# Veritas

**The verification layer for the agent economy.**

Payment rails prove you *paid*. They never prove the data was *true*. Veritas is
the thin gate between an agent's intent to pay and a seller getting paid, so an
agent only pays for data that is **provably correct** — verified by consensus on
**Solana**, settled gaslessly in **USDC on Arc** via Circle Gateway Nanopayments.

> An AI agent buys a price. Three sellers answer. One lies. Consensus catches the
> lie on Solana, the two honest sellers are paid in full, and **the liar earns
> exactly zero** — while a naive x402 buyer pays for the poisoned number.

---

## Status — mid-checkpoint

Phases 0–4 complete. The system is deployed and settling **real testnet USDC**
(nothing mocked on the money path).

| Component | Where | State |
|---|---|---|
| Veritas Anchor program | Solana Devnet | **live** — `CiGK2btZHdeW1U327ZLDhTQhDhP9TB6U16oG4a21YTUG` |
| Coordinator (facilitator) | Railway | **live** — [`/health`](https://coordinator-production-b0e4.up.railway.app/health) |
| Demo sellers (2 honest + 1 liar) | Railway | **live** — registered on Devnet, reputation 500 |
| Postgres mirror | Neon | **live** — migrations applied on boot |
| Circle settlement | Arc Testnet | **real** — `MOCK_SETTLE=false`, reconciler every 15s |
| Demo UI + dashboard | Vercel | deploying — see [`docs/DEPLOY.md`](docs/DEPLOY.md) |

Quality gates: `pnpm -w typecheck` green (14/14), `pnpm -w test` green
(51 TypeScript tests + 7 Rust litesvm tests; 7 further tests are env-gated on a
Devnet key and run separately).

### Verify it yourself, right now

The coordinator is public. No key required:

```sh
curl https://coordinator-production-b0e4.up.railway.app/health
curl https://coordinator-production-b0e4.up.railway.app/sellers

curl -X POST https://coordinator-production-b0e4.up.railway.app/quote \
  -H 'content-type: application/json' \
  -d '{"category":"crypto-prices","symbol":"BTC/USD","k":3}'
```

The quote returns three ranked sellers, a `300` fee, `15300` max exposure, and
network `eip155:5042002` (Arc Testnet) — exercising live discovery, seller
health-probing over a private network, and pricing.

### A real purchase on this deployment — check it yourself

Three sellers answered `50000`, `50100` and `55000`. Solana computed the truth,
the two honest sellers were paid in full, and the liar earned nothing:

```
consensus truth   50100        paid  $0.0103  (authorized up to $0.02)
acme-prices       50000.00     matched   paid $0.005
globex-feed       50100.00     matched   paid $0.005
sketchy-oracle    55000.00     OUTLIER   paid $0
```

**The verdict, on Solana Devnet** —
[`tk9UnSU2…hhNBD`](https://solscan.io/tx/tk9UnSU2ZKRMwynD5RA4NuDARS5htBosKB6MU7vqDPqnZpB2MmVuaG2iTr2ymfzykPM8thoaWY92MGc9a7hhNBD?cluster=devnet)

**The payment, on Circle Gateway** — the transfers API needs no authentication,
so you can confirm the money independently of anything we host:

```sh
curl https://gateway-api-testnet.circle.com/v1/x402/transfers/b706033c-0039-415a-a53f-f6922954d3b5
curl https://gateway-api-testnet.circle.com/v1/x402/transfers/f524b7ca-b7bc-4045-8f30-e3199733bd96
```

Each returns `"amount": "5000"` on `eip155:5042002`. There is **no third
transfer** — the liar's authorization was signed and then never redeemed.

**The consequence, back on Solana** — `GET /sellers` now shows the honest
sellers at reputation `510` (`matched=1`) and the liar at `450`
(`outliers=1`). Accuracy is monetized and inaccuracy is priced, automatically.

Reproduce it against any coordinator:

```sh
pnpm purchase https://coordinator-production-b0e4.up.railway.app
```

---

## Why an agent pays for this

A naive x402 buyer trusts one anonymous seller and pays on delivery. If that
seller is wrong — stale cache, bad upstream, or deliberate poisoning — the agent
acts on a false number and the money is already gone.

Veritas bounds that risk **before** anything is signed away:

- the agent pre-signs one **exact-amount, single-use** authorization per seller,
  so worst-case exposure is known up front (`15300`);
- the coordinator verifies every signature *and* the buyer's aggregate Gateway
  balance **before** any seller is asked for data;
- only the authorizations of sellers who matched consensus are ever redeemed.
  The liar's authorization is simply never used. Actual cost: `10300`.

## Why a seller says yes

**Every seller within tolerance of the median is paid its full asking price** —
this is not a competition where one winner takes the round. The only way to earn
nothing is to be wrong. And the protocol fee is charged *on top*, to the buyer:
**the seller's take rate is zero.**

What a seller gets that it cannot get anywhere else is a **public, on-chain
accuracy record**. Small data providers don't lose to incumbents on quality —
they lose because they have no way to *prove* quality. Veritas mints exactly
that credential, and the seller owns it.

Integration is a one-time registration, then five lines of middleware on an
endpoint they already run. Adapters ship for Express, Fastify and Next.

```ts
import { registerSeller, veritasSeller } from "@veritas/seller";

// once: creates the on-chain SellerAccount PDA + registers the capability
const seller = await registerSeller({
  name: "acme-prices",
  solanaKeypair,
  payoutAddress: "0x…",          // where won USDC lands on Arc
  endpoint: "https://acme.example.com",
  price: "5000",                  // USDC base units — $0.005 per answer
  mode: "consensus",
  capability: { category: "crypto-prices", coverage: ["BTC/USD"] },
  coordinatorUrl,
});

// per request: answer, get paid when you're right
app.use(veritasSeller({
  seller,
  coordinatorApiKey: process.env.COORDINATOR_API_KEY!,
  serve: async ({ symbol }) => {
    const price = await getPrice(symbol);
    return { value: price, payload: { symbol, price, ts: Date.now() } };
  },
}));
```

`value` is what consensus compares; `payload` is the full response delivered to
the buyer. Sellers never serve data to a caller without payment authority — the
middleware rejects any request missing the coordinator credential.

---

## Buying, from the agent side

One call. The budget cap is enforced **client-side, before anything is signed** —
if the quote's max exposure exceeds `maxPrice`, it aborts without ever
authorizing a payment.

```ts
import { Veritas, CircleEip3009Signer } from "@veritas/agent";

const veritas = new Veritas({
  facilitatorUrl: "https://coordinator-production-b0e4.up.railway.app",
  signer: new CircleEip3009Signer(process.env.ARC_PRIVATE_KEY as `0x${string}`),
});

const { data, verdict, finalCost } = await veritas.buy({
  category: "crypto-prices",
  symbol: "BTC/USD",
  maxPrice: "20000",
});
// data      → the consensus-verified value
// verdict   → truth, winners, outliers + the Solana tx that proves it
// finalCost → what you actually paid (winners + fee), never more than maxPrice
```

Any MCP-capable agent — Claude included — can buy verified data directly through
`@veritas/mcp`, which exposes `buy_verified_data` and `list_available_data` as
tools.

## How it works

```
agent ──quote──▶ coordinator ──fan-out──▶ K sellers
  │                   │
  │ pre-signs K+1     ├── verify sigs + Gateway balance   (Circle, before fan-out)
  │ exact-amount      ├── submit K answers                (Solana Devnet)
  │ authorizations    ├── finalize_consensus → verdict    (Solana Devnet)
  │                   └── redeem winners + fee only       (Circle Gateway, Arc)
  ▼
BuyResult { data, verdict, proof, finalCost }
```

**The money/truth split.** Solana stores truth — requests, verdicts, reputation,
stake. Arc moves money — gasless batched USDC. They touch at exactly one point:
the coordinator reads a Solana verdict, then redeems only the winners'
authorizations. No CCTP per payment, no mirror credits, no cross-chain hop per
transaction.

**Consensus** is computed on-chain in pure integer math. Numeric mode: truth is
the median, winners are everyone within `tolerance_bps` (default 100bps). Hash
mode: strict majority; no majority means the round fails and **nobody is paid**.
Reputation updates atomically with the verdict; outliers can be slashed 10%.
Caps: `K ≤ 7`, response ≤ 64 bytes.

**Trust model, stated plainly.** In this MVP the coordinator is a trusted
authority: it opens requests and submits the sellers' answers. The *verdict
computation and record* are on-chain and public, so anyone can audit that
settlement matched the verdict — trusted-but-auditable. Hardening path: sellers
signing their own responses, a challenge/slash game, and requiring a Solana
verdict proof before Arc settlement. See [Roadmap](#roadmap).

---

## Proven against live APIs

The real-money end-to-end test runs the whole path with nothing mocked, and
asserts against live Circle and Solana APIs:

- the buyer's Gateway balance is debited **exactly** `finalCost` — the loser's
  authorization is never redeemed;
- each winner is credited its exact price; the fee address is credited the fee;
  **the liar is credited `0`**;
- settlement rows carry real Gateway transfer ids, and the reconciler
  (`GET /v1/x402/transfers/:id`) is asserted truthful live;
- the `PENDING → AVAILABLE` flip was verified for real once Circle's batch
  landed on Arc, and recipient funds moved `pendingBatch` → spendable balance.

Facts discovered against the live Gateway API and baked into the implementation:
authorizations must be valid for **at least 7 days** (`minValiditySeconds:
604800` — the batch must stay redeemable until it lands on-chain); the EIP-712
signing domain is `{GatewayWalletBatched, 1, chainId, GatewayWallet}` — the
**Gateway wallet contract, not the USDC token**; and the x402 v2 verify/settle
endpoints require `paymentPayload.resource` and `paymentPayload.accepted`.

Circle batch-settles on its own cadence (~1.5–2h observed on the quiet testnet),
so the flip is not instant. Rows stay truthfully `PENDING` until it lands; the
status mapping is locked by unit tests.

---

## Run it

```sh
pnpm install
cp .env.example .env      # fill in keys
pnpm -w typecheck && pnpm -w test
```

Requires Node ≥ 22, pnpm ≥ 10; Rust + Anchor + Solana CLI for `programs/`.

**The 2-minute demo** (coordinator + 3 sellers + UI + explorer) is scripted
step by step in [`docs/DEMO.md`](docs/DEMO.md), including the narration and a
table mapping every claim to where you see it.

**One command proving the whole path** — sellers → agent `buy()` → Solana
verdict → settle winners → dashboard reflects it:

```sh
DEVNET_KEYPAIR=$(cat ~/.config/solana/id.json) pnpm --filter @veritas/e2e test
```

**With real money on Arc Testnet** (needs an EOA key + USDC from
[faucet.circle.com](https://faucet.circle.com)):

```sh
DEVNET_KEYPAIR=$(cat ~/.config/solana/id.json) \
  pnpm --filter @veritas/e2e test real-money
```

---

## Layout

```
programs/veritas/    Anchor program — consensus verdicts, seller registry, reputation, stake/slash
packages/core/       @veritas/core     shared types, constants, hashing, x402 helpers
packages/onchain/    @veritas/onchain  typed Anchor client + PDA helpers
packages/seller-sdk/ @veritas/seller   5-line middleware (Express / Fastify / Next)
packages/agent-sdk/  @veritas/agent    one-call buyer SDK + EIP-3009 signing
packages/mcp/        @veritas/mcp      MCP server — any LLM agent can buy verified data
apps/coordinator/    Hono facilitator — fan-out, verdicts, Circle settlement, reconciler
apps/dashboard/      Next.js seller dashboard + public truth-ledger explorer
apps/demo/           the "liar caught by consensus" live demo + 3 demo sellers
tests/e2e/           @veritas/e2e      full-system + real-money end-to-end tests
```

Deployment runbook (Railway + Neon + Vercel): [`docs/DEPLOY.md`](docs/DEPLOY.md).

---

## Roadmap

Delivered in phases 0–4: the on-chain program, coordinator, both SDKs, the MCP
server, the demo, the explorer, and the real Circle settlement path.

Next, in priority order:

1. **Signed seller responses + commit–reveal** — sellers sign their own values so
   the coordinator cannot forge them, and cannot leak one seller's answer to
   another. This is what makes the on-chain ledger trustworthy without trusting
   the operator.
2. **Staking and slashing through the SDK** — the Anchor instructions and 10%
   slash exist and are Rust-tested; exposing them puts real economics on Solana.
3. **Challenge + slash game** — bonded disputes for contested verdicts.
4. **Trustless settlement link** — require a Solana verdict proof before Arc
   settlement, reducing coordinator trust to near zero.
5. Indexer, Python SDK, reputation v2, security audit, mainnet.

### Known limitations

Stated deliberately, because they shape how the current numbers should be read:

- The coordinator is trusted-but-auditable (see above) — item 1 above fixes this.
- Consensus proves **independent corroboration, not ground truth**. If sellers
  share an upstream, agreement is not evidence. Source diversity in discovery
  and content-addressed mode (K=1) address this; it is not fully solved.
- Quote state is in-memory, so the coordinator runs at one replica today.
- Testnet only: Solana Devnet + Arc Testnet. Mainnet waits on an audit and on
  Circle Nanopayments mainnet availability.
```
