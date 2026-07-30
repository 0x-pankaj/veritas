# Selling verified data on Veritas

You run a data feed. Veritas turns it into a product agents can trust — and
pays you **your full asking price, in USDC on Arc, every time you're right**.

## The deal, in numbers

- You set your own price per answer (USDC base units — `"5000"` = $0.005).
- A buyer's query fans out to K sellers. **Everyone within 100 bps of the
  median is paid their full price.** This is not winner-take-all; the only way
  to earn nothing is to be wrong.
- The protocol fee (200 bps) is charged to the **buyer, on top**. Your take
  rate is zero.
- Every answer updates your **public, on-chain accuracy record** on Solana:
  reputation, rounds served, matches, outliers. This is the credential small
  providers can't get anywhere else — proof of quality, owned by you.

## What you need

- Node ≥ 22 and an HTTP endpoint you control (Express, Fastify, or Next).
- A Solana keypair (Devnet) with a fraction of a cent of SOL — it signs your
  on-chain registration and becomes your identity.
- The coordinator URL and its fan-out credential
  (`COORDINATOR_API_KEY` — issued by the coordinator operator in the MVP).
- An EVM address on Arc where your USDC lands (`payoutAddress`). Any EOA you
  control works.

## 1. Register (once)

```ts
import { registerSeller } from "@veritas/seller";

const seller = await registerSeller({
  name: "acme-prices",
  solanaKeypair,                    // your Solana identity
  payoutAddress: "0x…",             // your EOA on Arc — settled USDC lands here
  endpoint: "https://api.acme.com", // where the coordinator reaches you
  price: "5000",                    // $0.005 per answer
  mode: "consensus",
  capability: {
    category: "crypto-prices",      // one of the platform categories
    coverage: ["BTC/USD"],          // the keys you can answer
    schema: "{ symbol, price, ts }",
    freshnessSec: 5,
  },
  coordinatorUrl: "https://coordinator-production-b0e4.up.railway.app",
});
```

This does two idempotent things: creates your `SellerAccount` PDA on Solana
(your reputation lives there), and upserts your capability row in the
coordinator's discovery registry. Re-running is safe.

Categories today: `crypto-prices`, `prediction-markets`, `sports-odds`,
`weather`, `onchain-analytics`.

## 2. Serve (five lines of middleware)

```ts
import { veritasSeller } from "@veritas/seller";

app.use(veritasSeller({
  seller,                                     // the handle from registerSeller
  coordinatorApiKey: process.env.COORDINATOR_API_KEY!,
  serve: async ({ symbol }) => {
    const price = await getPrice(symbol);
    return { value: price, payload: { symbol, price, ts: Date.now() } };
  },
}));
```

- `value` is the canonical comparable consensus judges (a decimal string in
  numeric mode). `payload` is the full response delivered to the buyer.
- The middleware refuses any request without the coordinator credential — you
  never serve data to a caller with no payment authority.
- **Every response is automatically signed with your Solana identity key**
  (ed25519 over the query id and your value). The coordinator verifies the
  signature before your answer enters consensus and republishes it on
  `/verify`, so nobody — including the coordinator — can alter or fabricate
  what you said. Your recorded answers are provably yours.

Adapters ship for Express, Fastify and Next; `handleServe` is exposed for any
other framework.

## 3. Get paid

When you match consensus, the buyer's pre-signed EIP-3009 authorization for
**exactly your price, to exactly your address** is redeemed through Circle
Gateway. No gas, no invoicing, no net-30.

- Funds appear in your Gateway balance as `pendingBatch`, then become
  spendable when Circle batch-settles on Arc (~1.5–2 h cadence on testnet).
- Every payment is independently checkable — Circle's transfers API requires
  no auth: `curl https://gateway-api-testnet.circle.com/v1/x402/transfers/<id>`.
- If you're an outlier, the authorization for your price is simply never
  redeemed. You don't owe anything; you just weren't paid — and your on-chain
  record shows the miss.

## 4. Watch your record

```sh
curl https://coordinator-production-b0e4.up.railway.app/sellers
curl https://coordinator-production-b0e4.up.railway.app/explorer/sellers/<your-id>
```

Reputation starts at 500 and moves with every round — up when you match,
sharply down when you're an outlier. It mirrors the on-chain account: Solana
is the source of truth, the registry is a fast read.

## Operational notes

- **Keep your keypair safe and stable.** Your Solana key *is* your identity
  and your reputation. Registering the same endpoint with a new key supersedes
  the old registration (the old record stays auditable, but its reputation
  doesn't transfer).
- **Price honestly.** Discovery ranks by reputation; consensus pays everyone
  who's right. Undercutting doesn't win rounds — being consistently correct
  does.
- Dead endpoints are health-probed out of discovery automatically; fix your
  endpoint and you're picked again on the next quote.
