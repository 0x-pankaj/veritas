# Veritas — deploy

The live topology, as deployed:

| Piece | Where | Why |
|---|---|---|
| **coordinator** | Railway (always-on container) | does post-response settlement work + holds in-flight round state |
| **sellers** (3 demo feeds) | Railway (private network only) | reached by the coordinator at `sellers.railway.internal:9101-9103` |
| **Postgres** | Neon (managed, external) | the off-chain mirror |
| **demo UI** | Vercel | stateless Next.js + one request-scoped API route |
| **dashboard** | Vercel | stateless Next.js, thin coordinator client |

> **Ruling (do not revisit):** the coordinator is an **always-on container**,
> never a serverless function — it does post-response settlement redemption and
> runs the settlement reconciler loop. The two Next.js apps are stateless and
> belong on Vercel.

Solana runs on **Devnet**; Circle settlement is **real** on **Arc Testnet**
(`MOCK_SETTLE=false`).

---

## Live URLs

- Coordinator: `https://coordinator-production-b0e4.up.railway.app`
- Railway project: `https://railway.com/project/67ab9334-7348-403d-89b3-98c5a04ef719`

---

## 1. Railway — coordinator + sellers

```sh
railway login
railway init -n veritas
railway add --service coordinator
railway add --service sellers
```

Railway has no CLI flag for config-as-code paths, so the Dockerfile is pinned
per service with `RAILWAY_DOCKERFILE_PATH` (the `railway.*.json` files at the
repo root remain the reference for healthcheck/restart policy):

```sh
railway variables --service coordinator --set "RAILWAY_DOCKERFILE_PATH=apps/coordinator/Dockerfile"
railway variables --service sellers     --set "RAILWAY_DOCKERFILE_PATH=apps/demo/Dockerfile.sellers"
```

### Coordinator variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | the Neon pooled connection string (`?sslmode=require`) |
| `COORDINATOR_PORT` | `3001` |
| `COORDINATOR_API_KEY` | shared secret, **≥ 16 chars** (sellers use the same) |
| `MOCK_SETTLE` | `false` — real Circle settlement |
| `GATEWAY_API_URL` | `https://gateway-api-testnet.circle.com` |
| `SETTLE_POLL_MS` | `15000` — reconciler cadence |
| `VERITAS_FEE_BPS` | `200` |
| `VERITAS_FEE_ADDRESS` | your Veritas fee EVM address |
| `SOLANA_RPC` | a Devnet RPC — **use Helius/Triton, not the public endpoint** |
| `SOLANA_KEYPAIR` | Devnet coordinator key, JSON byte array |

Deploy and expose it:

```sh
railway up --service coordinator --detach
railway domain --service coordinator --port 3001
curl https://<coordinator-domain>/health   # {"ok":true,"service":"veritas-coordinator"}
```

Migrations run automatically on boot (`drizzle-kit migrate` in the container
CMD), so a fresh Neon database is initialised by the first deploy.

### Seller variables

No public domain — the coordinator reaches them over the private network.

| Variable | Value |
|---|---|
| `VERITAS_FACILITATOR_URL` | `http://coordinator.railway.internal:3001` |
| `SELLER_HOST` | `sellers.railway.internal` — **set the literal, not a `${{…}}` reference** |
| `COORDINATOR_API_KEY` | same secret as the coordinator |
| `SOLANA_RPC` | same Devnet RPC |
| `DEVNET_KEYPAIR` | Devnet key with SOL (funds + registers the 3 sellers) |

Deploy **after** the coordinator is healthy — the sellers register against it on
boot:

```sh
railway up --service sellers --detach
curl https://<coordinator-domain>/sellers   # the 3 sellers, reputation 500
```

> **Two platform gotchas, both fixed in code — do not reintroduce:**
> 1. All three sellers share one container, so they must be started on
>    **explicit ports**. Railway injects a single `PORT` per service; letting
>    the sellers inherit it collapses them onto one port (`EADDRINUSE`).
>    `PORT` is still honoured for the single-seller entry scripts.
> 2. `SELLER_HOST` is read with `||`, not `??`. A blank injected value would
>    otherwise build the endpoint `http://:9101`, which the coordinator's
>    registration schema rejects as an invalid URL.

## 2. Neon — Postgres

Create a database and copy the **pooled** connection string into the
coordinator's `DATABASE_URL`. Nothing else is required; the coordinator applies
migrations on boot. Nothing but the coordinator ever talks to the database —
the dashboard reads through the coordinator's HTTP API.

## 3. Vercel — demo UI + dashboard

Two Vercel projects from the same repo. Each app ships a `vercel.json` that
handles the monorepo build, so the only manual settings are:

- **Root Directory**: `apps/demo` / `apps/dashboard`
- Enable **"Include source files outside of the Root Directory"** (the apps
  import workspace packages).

Environment variables:

| Project | Variable | Value |
|---|---|---|
| dashboard | `VERITAS_FACILITATOR_URL` | `https://<coordinator-domain>` |
| demo | `VERITAS_FACILITATOR_URL` | `https://<coordinator-domain>` |
| demo | `ARC_PRIVATE_KEY` | buyer EOA private key, funded via faucet.circle.com |

`ARC_PRIVATE_KEY` is what makes the public demo spend **real** testnet USDC: the
route signs live EIP-3009 authorizations. Without it the orchestrator falls back
to `LocalEip3009Signer` and the purchase is structurally valid but unsettled.
The demo also keeps a canned fallback (`DEMO_MOCK=1` forces it) so the page
still renders if the coordinator or Gateway is unreachable.

The demo's API route is capped at `maxDuration: 60` — a full verified purchase
(sign → verify against live Gateway → fan-out → Solana verdict → settle) runs
well inside that, but it is not a sub-second request.

## 4. Prove it in production

```sh
# a live quote — exercises discovery, health-probing and pricing
curl -X POST https://<coordinator-domain>/quote \
  -H 'content-type: application/json' \
  -d '{"category":"crypto-prices","symbol":"BTC/USD","k":3}'

# the whole path against the deployed coordinator
DEVNET_KEYPAIR=$(cat ~/.config/solana/id.json) \
DATABASE_URL='<neon url>' \
VERITAS_FACILITATOR_URL='https://<coordinator-domain>' \
  pnpm --filter @veritas/e2e test
```

Or open the demo URL and click **Buy verified BTC/USD price** — the liar is
caught, winners are paid on Arc, and the verdict appears in the dashboard's
truth ledger with its Solana tx.

---

## Local Docker parity

Every image builds and runs locally (what Railway does):

```sh
docker build -f apps/coordinator/Dockerfile   -t veritas-coordinator .
docker build -f apps/dashboard/Dockerfile     -t veritas-dashboard .
docker build -f apps/demo/Dockerfile          -t veritas-demo .
docker build -f apps/demo/Dockerfile.sellers  -t veritas-sellers .
```
