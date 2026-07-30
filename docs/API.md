# Coordinator HTTP API

Base URL (live): `https://coordinator-production-b0e4.up.railway.app`

Everything below is public — the API needs **no key**. Payment authority *is*
the auth: a `/buy` succeeds only with valid, funded EIP-3009 authorizations,
and everything else is read-only. (The only credential in the system is the
one the **coordinator presents to sellers** on fan-out, `x-veritas-coordinator`;
buyers never need it.)

Amounts are USDC 6-decimal base units as strings (`"5000"` = $0.005).
Errors are `{ "error": "<message>" }` with a non-2xx status.

---

## GET /health

```json
{ "ok": true, "service": "veritas-coordinator" }
```

## GET /sellers?category=&symbol=

Active sellers, best reputation first. Both query params optional.

```json
{ "sellers": [ {
  "id": "…", "solanaPubkey": "…", "name": "acme-prices",
  "price": "5000", "mode": "CONSENSUS",
  "category": "crypto-prices", "coverage": ["BTC/USD"],
  "schemaDesc": "{ symbol, price, ts }", "freshnessSec": 5,
  "reputation": 540, "served": 4, "matched": 4, "outliers": 0
} ] }
```

## POST /sellers/register

Upsert on `solanaPubkey` (idempotent). Registering an endpoint that a
*different* identity currently holds supersedes the old registration (the old
row is suspended, its history stays auditable).

```json
{
  "solanaPubkey": "base58",
  "payoutAddress": "0x…40 hex…",
  "name": "acme-prices",
  "endpoint": "https://api.acme.com",
  "price": "5000",
  "mode": "CONSENSUS",
  "category": "crypto-prices",
  "coverage": ["BTC/USD"],
  "schemaDesc": "{ symbol, price, ts }",
  "freshnessSec": 5
}
```

→ `201 { "id", "solanaPubkey", "reputation", "status" }`.
Use `registerSeller` from `@veritas/seller` rather than calling this raw — it
also creates the on-chain SellerAccount ([SELLERS.md](SELLERS.md)).

## POST /quote

```json
{ "category": "crypto-prices", "symbol": "BTC/USD", "k": 3 }
```

→ `200`:

```json
{
  "quoteId": "uuid",
  "candidates": [ { "sellerId": "…", "payoutAddress": "0x…", "price": "5000" } ],
  "fee": "300",
  "feeAddress": "0x…",
  "maxExposure": "15300",
  "network": "eip155:5042002",
  "expiresAt": 1785439424019
}
```

`409` — not enough live sellers for that category/symbol (candidates are
health-probed; dead endpoints don't count). Quotes are single-use and expire.

## POST /buy

```json
{
  "quoteId": "uuid from /quote",
  "authorizations": [ {
    "from": "0xbuyer", "to": "0xseller-payout", "value": "5000",
    "validAfter": 0, "validBefore": 1785440000,
    "nonce": "0x…64 hex…", "signature": "0x…"
  } ]
}
```

One exact-amount authorization per candidate (matched on `to` + `value`) plus
one for the fee. All signatures **and** the buyer's aggregate Gateway balance
are verified *before* any seller is contacted.

→ `200`:

```json
{
  "queryId": "64-hex",
  "data": { "truth": "50100", "payloads": [ … ] },
  "verdict": {
    "truth": "50100",
    "winners": ["sellerId…"], "outliers": ["sellerId…"],
    "solanaTx": "base58 signature", "requestPda": "base58"
  },
  "finalCost": "10300"
}
```

Only winners' + fee authorizations are ever redeemed (async, off the critical
path). Errors: `410` unknown/expired quote · `400` missing authorization ·
`402` invalid or underfunded authorization · `502` quorum not met (**nothing
charged** — pay-after-verdict).

## GET /verify/:queryId

The full public audit record of a purchase:

```json
{
  "queryId": "…", "status": "DONE", "truth": "50100", "k": 3,
  "cost": "10300", "buyer": "0x…",
  "solanaTx": "…", "requestPda": "…",
  "responses": [ {
    "sellerId": "…", "name": "acme-prices", "solanaPubkey": "base58",
    "valueOrHash": "50000.00", "matched": true, "latencyMs": 46,
    "signature": "0x…128 hex…"
  } ],
  "settlements": [ {
    "sellerId": "…", "name": "acme-prices", "amount": "5000",
    "status": "PENDING | AVAILABLE | FAILED",
    "gatewayTx": "circle transfer id"
  } ]
}
```

**Verifying a response signature yourself** — `signature` is ed25519 over the
UTF-8 message below, checkable against `solanaPubkey` (base58-decoded) with
any ed25519 library, or `verifyResponseSig` from `@veritas/core`:

```
veritas-response-v1\n{queryId}\n{valueOrHash}
```

**Verifying a settlement yourself** — Circle's transfers API is public:

```sh
curl https://gateway-api-testnet.circle.com/v1/x402/transfers/<gatewayTx>
```

`404` — unknown query id.

## Explorer (read models for the dashboard)

- `GET /explorer/verdicts?limit=25` — recent verdicts
  (`id`, `truth`, `status`, `k`, `cost`, `solanaTx`, `createdAt`). `limit` 1–200.
- `GET /explorer/sellers` — seller stats incl. accuracy % and aggregated
  earnings.
- `GET /explorer/sellers/:id` — one seller: stats + its last 50 rounds
  (value, matched, truth, latency). `404` if unknown.

---

## Related

- Sell data: [SELLERS.md](SELLERS.md)
- Buy data (SDK + MCP): [AGENTS.md](AGENTS.md)
- Run the demo: [DEMO.md](DEMO.md) · Deploy the stack: [DEPLOY.md](DEPLOY.md)
