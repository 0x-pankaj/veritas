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
| Demo sellers (2 honest + 1 liar) | Railway | **live** — pinned Devnet identities, signed responses, real payout EOAs |
| Postgres mirror | Neon | **live** — migrations applied on boot |
| Circle settlement | Arc Testnet | **real** — `MOCK_SETTLE=false`, reconciler every 15s |
| Demo UI + dashboard | Vercel | deploying — see [`docs/DEPLOY.md`](docs/DEPLOY.md) |

Quality gates: `pnpm -w typecheck` green (14/14), `pnpm -w test` green
(56 TypeScript tests + 7 Rust litesvm tests; 7 further tests are env-gated on a
Devnet key and run separately). The signature path is tested adversarially:
forged signatures and tampered values are dropped at ingest.

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
the two honest sellers were paid in full, and the liar earned nothing — and
every answer carries the seller's own ed25519 signature, re-verified
client-side:

```
consensus truth   50100        paid  $0.0103  (authorized up to $0.02)   5.4s
acme-prices       50000.00     matched   paid $0.005   sig valid
globex-feed       50100.00     matched   paid $0.005   sig valid
sketchy-oracle    55000.00     OUTLIER   paid $0       sig valid
```

**The verdict, on Solana Devnet** —
[`3E3wT2Fg…ttuEX`](https://solscan.io/tx/3E3wT2FggfA6Y6FjRqXTAypHzAHqcM2VqH5nHJvxsxMtZTsHEwcFkxNPAw5ZE9uM3UGZNurbsRvTmq12VMuttuEX?cluster=devnet)

**The payment, on Circle Gateway** — the transfers API needs no authentication,
so you can confirm the money independently of anything we host:

```sh
curl https://gateway-api-testnet.circle.com/v1/x402/transfers/c77ea2a6-6d79-4192-bda6-619b815afdf5
curl https://gateway-api-testnet.circle.com/v1/x402/transfers/a2bddc23-21b0-46f3-9f38-93d783ad6595
```

Each returns `"amount": "5000"` on `eip155:5042002`, paid to the seller's
**own** payout EOA (derived from its Solana identity key — no placeholder
addresses). There is **no third transfer** — the liar's authorization was
signed and then never redeemed.

**The full audit record** — who answered what, each answer's signature and the
seller pubkey to check it against, and what settled:

```sh
curl https://coordinator-production-b0e4.up.railway.app/verify/597a99fbb2db745ddeca39b47f5e3f0d56b0285dc796893494b8a057463f422d
```

**The lifecycle closes on-chain.** An earlier purchase on this same deployment
has already gone the whole way: its transfers read `"status": "completed"` with
the on-chain batch transaction
[`0xc19dffcb…d46686`](https://testnet.arcscan.app/tx/0xc19dffcbc2f2b21b1eea57134c394d83f4fc43937f6cc1d0abccb6c521d46686)
on Arc Testnet, and its settlement rows flipped `PENDING → AVAILABLE`
([audit](https://coordinator-production-b0e4.up.railway.app/verify/b7500b1c6742b620ebbec6a0f60cea54bdfc939d58c4c774685177ce6e4e230b)).
Authorization signed → redeemed → batched → settled on-chain, all verifiable.

**The consequence, back on Solana** — `GET /sellers` mirrors the on-chain
record: the honest sellers stand at reputation `540` (`matched=4`) and the liar
at `300` (`outliers=4`), accumulated across every round these identities have
ever served. Accuracy is monetized and inaccuracy is priced, automatically.

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
Full guide: [`docs/SELLERS.md`](docs/SELLERS.md).

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
middleware rejects any request missing the coordinator credential. Every answer
is also **automatically signed with the seller's Solana identity key**, so the
coordinator cannot misattribute or alter what a seller said — the public record
on `/verify` is checkable against the seller's own on-chain pubkey.

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
tools; with `ARC_PRIVATE_KEY` set it settles real USDC on Arc. Full guide (SDK,
cost model, auditing, MCP config): [`docs/AGENTS.md`](docs/AGENTS.md).

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

**Signed responses.** Every seller answer is signed with the seller's Solana
identity key (ed25519 over the query id and the value) — the same key that owns
its on-chain SellerAccount. The coordinator verifies the signature against the
registered pubkey before an answer can enter consensus, and republishes it on
`GET /verify/:queryId`, so **anyone can re-check offline that every recorded
answer really came from that seller**. A forged or altered response fails
verification and is dropped; the coordinator cannot invent an answer a seller
never gave. (`pnpm purchase` performs exactly this re-check client-side.)

**Trust model, stated plainly.** The coordinator still chooses which sellers to
query and submits the round to Solana, but it can no longer forge or alter
response content — signatures made that check public. The *verdict computation
and record* are on-chain, so anyone can audit that settlement matched the
verdict. Remaining hardening: commit–reveal (so one seller's answer can't be
leaked to another), a challenge/slash game, and requiring a Solana verdict
proof before Arc settlement. See [Roadmap](#roadmap).

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

### Documentation

| Guide | For |
|---|---|
| [`docs/SELLERS.md`](docs/SELLERS.md) | data providers — register, serve, get paid, build an on-chain accuracy record |
| [`docs/AGENTS.md`](docs/AGENTS.md) | buyers — the one-call SDK, cost model, auditing, and the MCP server for AI agents |
| [`docs/API.md`](docs/API.md) | the coordinator's public HTTP API, incl. how to re-verify signatures and settlements yourself |
| [`docs/DEMO.md`](docs/DEMO.md) | the scripted 2-minute demo, claim by claim |
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | deployment runbook (Railway + Neon + Vercel) |

---

## Roadmap

Delivered in phases 0–4: the on-chain program, coordinator, both SDKs, the MCP
server, the demo, the explorer, and the real Circle settlement path.

**Delivered since the checkpoint plan was written:** signed seller responses —
every answer now carries an ed25519 signature by the seller's Solana identity
key, verified on ingest and re-checkable by anyone from `/verify` (this was
roadmap item 1's first half).

Next, in priority order:

1. **Commit–reveal** — sellers commit a hash before revealing values, so the
   coordinator cannot leak one seller's answer to another mid-round.
2. **Staking and slashing through the SDK** — the Anchor instructions and 10%
   slash exist and are Rust-tested; exposing them puts real economics on Solana.
3. **Challenge + slash game** — bonded disputes for contested verdicts.
4. **Trustless settlement link** — require a Solana verdict proof before Arc
   settlement, reducing coordinator trust to near zero.
5. Indexer, Python SDK, reputation v2, security audit, mainnet.

### Known limitations

Stated deliberately, because they shape how the current numbers should be read:

- The coordinator can no longer forge responses (they are seller-signed), but it
  still chooses which sellers to query and when to submit rounds — items 1 and 4
  above shrink that further.
- Consensus proves **independent corroboration, not ground truth**. If sellers
  share an upstream, agreement is not evidence. Source diversity in discovery
  and content-addressed mode (K=1) address this; it is not fully solved.
- Quote state is in-memory, so the coordinator runs at one replica today.
- Testnet only: Solana Devnet + Arc Testnet. Mainnet waits on an audit and on
  Circle Nanopayments mainnet availability.
```
