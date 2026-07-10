"use client";

import { useState } from "react";
import type { DemoResult, DemoSellerResult } from "../src/demo/orchestrator";

/** USDC 6-decimal base units → "$0.0103". */
function fmtUsdc(baseUnits: string): string {
  const n = Number(baseUnits) / 1e6;
  return `$${n.toFixed(n < 0.01 ? 4 : 2)}`;
}

/** A dollar price string like "50100" → "$50,100.00". */
function fmtPrice(value: string): string {
  const n = Number(value);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SellerRow({ s }: { s: DemoSellerResult }) {
  return (
    <div className={`seller ${s.matched ? "win" : "lose"}`}>
      <div>
        <div className="name">{s.name}</div>
        <div className="val">
          answered {fmtPrice(s.value)} · reputation {s.reputation}
          {s.settled ? ` · paid ${fmtUsdc(s.settled)}` : " · paid nothing"}
        </div>
      </div>
      <span className={`pill ${s.matched ? "win" : "lose"}`}>
        {s.matched ? "matched" : "outlier"}
      </span>
    </div>
  );
}

export default function Page() {
  const [result, setResult] = useState<DemoResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/demo/run", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol: "BTC/USD" }),
      });
      if (!res.ok) throw new Error(`demo run failed (${res.status})`);
      setResult((await res.json()) as DemoResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="wrap">
      <h1 className="title">Veritas</h1>
      <p className="subtitle">
        An AI agent asks for the BTC/USD price. One seller lies. Watch consensus
        catch it on Solana — and watch the liar earn nothing. The same purchase
        through naive x402 pays for the lie.
      </p>

      <button className="run-btn" onClick={run} disabled={loading}>
        {loading ? "Buying verified data…" : "Buy verified BTC/USD price"}
      </button>

      {error ? <p className="note">Error: {error}</p> : null}
      {result?.note ? <p className="note">{result.note}</p> : null}

      {result ? (
        <>
          <div className="cols">
            {/* Naive x402 — trusts one seller, pays regardless */}
            <section className="panel naive">
              <h2>Naive x402</h2>
              <div className="tag">Trust one seller · pay on delivery</div>
              <div className={`big ${result.naive.correct ? "good" : "bad"}`}>
                {fmtPrice(result.naive.value)}
              </div>
              <div className={`verdict ${result.naive.correct ? "good" : "bad"}`}>
                {result.naive.correct
                  ? "Happened to be correct — but you had no way to know."
                  : `Acted on a lie from ${result.naive.sellerName} — and paid ${fmtUsdc(
                      result.naive.paid,
                    )} for it.`}
              </div>
            </section>

            {/* Veritas verified — consensus, only winners paid */}
            <section className="panel verified">
              <h2>Veritas verified</h2>
              <div className="tag">
                {result.sellers.length} sellers · consensus on Solana
              </div>
              <div className="big good">{fmtPrice(result.truth)}</div>
              <div className="verdict good">
                Verified truth. {result.sellers.filter((s) => s.matched).length} sellers
                paid, {result.sellers.filter((s) => !s.matched).length} liar earned 0.
              </div>
              {result.sellers.map((s) => (
                <SellerRow key={s.sellerId} s={s} />
              ))}
            </section>
          </div>

          <div className="meta">
            <div>
              <b>Total cost:</b> {fmtUsdc(result.finalCost)}
            </div>
            <div>
              <b>Mode:</b> {result.mode}
            </div>
            <div className="mono">
              <b>Solana tx:</b> {result.solanaTx}
            </div>
            {result.requestPda ? (
              <div className="mono">
                <b>Request PDA:</b> {result.requestPda}
              </div>
            ) : null}
          </div>
        </>
      ) : null}
    </main>
  );
}
