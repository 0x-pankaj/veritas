# Veritas — deploy to Railway

Deploys the whole stack so a grant reviewer reaches it from one URL: an
always-on **coordinator** container + managed **Postgres** + the **demo** UI +
the **dashboard** + the three **demo sellers**. Solana runs on Devnet; Circle
settlement is mocked (`MOCK_SETTLE=true`).

> **Ruling (do not revisit):** the coordinator is an **always-on container**,
> never a serverless function — it does post-response settlement work and holds
> in-flight round state. All four services build from Docker (validated locally:
> `docker build` + run for each).

Service configs live at the repo root: `railway.coordinator.json`,
`railway.dashboard.json`, `railway.demo.json`, `railway.sellers.json` (each pins
its Dockerfile + healthcheck). All services use **repo root** as the build
context (root directory `/`) — the Dockerfiles are monorepo-aware.

---

## 0. One-time

```sh
npm i -g @railway/cli
railway login            # opens a browser — run this yourself
```

> In this session you can run it inline: type `! railway login`.

## 1. Project + Postgres

```sh
railway init -n veritas             # create the project
railway add --database postgres     # managed Postgres → provides DATABASE_URL
```

## 2. Coordinator (deploy first — everything points at it)

Create a service from this repo with **config path** `railway.coordinator.json`
(Railway dashboard → New Service → GitHub repo → Settings → Config-as-code path),
then set variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` (reference) |
| `COORDINATOR_API_KEY` | a shared secret, **≥ 16 chars** |
| `MOCK_SETTLE` | `true` |
| `VERITAS_FEE_BPS` | `200` |
| `VERITAS_FEE_ADDRESS` | `0x…` your Veritas fee EVM address |
| `SOLANA_RPC` | a Devnet RPC (Helius/Triton free tier recommended) |
| `SOLANA_KEYPAIR` | the Devnet coordinator key as a JSON byte array |

Deploy, then **Generate Domain**. Migrations run automatically on boot. Verify:

```sh
curl https://<coordinator-domain>/health     # {"ok":true,"service":"veritas-coordinator"}
```

## 3. Dashboard

Service with config path `railway.dashboard.json`. Variables:

| Variable | Value |
|---|---|
| `DATABASE_URL` | `${{Postgres.DATABASE_URL}}` |

Generate a domain → the truth-ledger explorer.

## 4. Demo sellers

Service with config path `railway.sellers.json`. No public domain (the
coordinator reaches them over the private network). Variables:

| Variable | Value |
|---|---|
| `VERITAS_FACILITATOR_URL` | `http://${{coordinator.RAILWAY_PRIVATE_DOMAIN}}:3001` |
| `COORDINATOR_API_KEY` | same secret as the coordinator |
| `SELLER_HOST` | `${{sellers.RAILWAY_PRIVATE_DOMAIN}}` (so registered endpoints are reachable) |
| `SOLANA_RPC` | same Devnet RPC |
| `DEVNET_KEYPAIR` | a Devnet key with SOL (funds + registers the 3 sellers) |

On boot this funds the three seller identities, registers them on Devnet + the
coordinator, and serves them on ports 9101–9103 over the private network.

## 5. Demo UI (deploy last)

Service with config path `railway.demo.json`. Variables:

| Variable | Value |
|---|---|
| `VERITAS_FACILITATOR_URL` | `https://<coordinator-domain>` (public) |

Generate a domain → **this is the public demo URL.**

## 6. Prove it in production

```sh
# from a machine with the Devnet key + the prod DATABASE_URL:
DEVNET_KEYPAIR=$(cat ~/.config/solana/id.json) \
DATABASE_URL='<prod url>' \
VERITAS_FACILITATOR_URL='https://<coordinator-domain>' \
  pnpm --filter @veritas/e2e test
```

Or just open the demo URL and click **Buy verified BTC/USD price** — the liar is
caught, winners are paid, and the verdict appears in the dashboard's truth
ledger with its Solana tx.

---

## Local Docker parity

Every image builds and runs locally (what CI/Railway will do):

```sh
docker build -f apps/coordinator/Dockerfile   -t veritas-coordinator .
docker build -f apps/dashboard/Dockerfile     -t veritas-dashboard .
docker build -f apps/demo/Dockerfile          -t veritas-demo .
docker build -f apps/demo/Dockerfile.sellers  -t veritas-sellers .
```

Run the coordinator against a local Postgres:

```sh
docker run --rm --network host \
  -e DATABASE_URL='postgres://…' -e COORDINATOR_PORT=3001 \
  -e COORDINATOR_API_KEY='demo-coordinator-key-0123456789' \
  -e MOCK_SETTLE=true -e VERITAS_FEE_BPS=200 \
  -e VERITAS_FEE_ADDRESS=0x00000000000000000000000000000000000000Fe \
  -e SOLANA_RPC=https://api.devnet.solana.com \
  -e SOLANA_KEYPAIR="$(cat ~/.config/solana/id.json)" \
  veritas-coordinator
```
