import Link from "next/link";
import { notFound } from "next/navigation";
import { getVerdict } from "../../../src/data";
import { fmtPrice, fmtUsdc, solscanTx, truncateMiddle } from "../../../src/format";

export const dynamic = "force-dynamic";

export default async function VerdictPage({
  params,
}: {
  params: Promise<{ queryId: string }>;
}) {
  const { queryId } = await params;
  const detail = await getVerdict(queryId);
  if (!detail) notFound();

  const { query, responses, settlements } = detail;
  const paidBySeller = new Map(settlements.map((s) => [s.sellerId, s]));
  const tx = solscanTx(query.solanaTx);

  return (
    <>
      <p className="back">
        <Link href="/">← truth ledger</Link>
      </p>
      <h1>Verdict</h1>
      <p className="sub mono">{query.id}</p>

      <div className="cards">
        <div className="card">
          <div className="label">Consensus truth</div>
          <div className="value">{fmtPrice(query.truth)}</div>
        </div>
        <div className="card">
          <div className="label">Sellers (K)</div>
          <div className="value">{query.k}</div>
        </div>
        <div className="card">
          <div className="label">Final cost</div>
          <div className="value">{fmtUsdc(query.cost)}</div>
        </div>
        <div className="card">
          <div className="label">Status</div>
          <div className="value" style={{ fontSize: 16 }}>
            {query.status.toLowerCase()}
          </div>
        </div>
      </div>

      <h2>Responses</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Seller</th>
              <th>Answer</th>
              <th>Verdict</th>
              <th>Latency</th>
              <th>Paid</th>
            </tr>
          </thead>
          <tbody>
            {responses.map((r) => {
              const paid = paidBySeller.get(r.sellerId);
              return (
                <tr key={r.sellerId}>
                  <td>
                    <Link href={`/sellers/${r.sellerId}`}>{r.name}</Link>
                  </td>
                  <td className="num">{fmtPrice(r.value)}</td>
                  <td>
                    <span className={`pill ${r.matched ? "good" : "bad"}`}>
                      {r.matched ? "matched" : "outlier"}
                    </span>
                  </td>
                  <td className="num">{r.latencyMs} ms</td>
                  <td className="num">
                    {paid ? `${fmtUsdc(paid.amount)} (${paid.status.toLowerCase()})` : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h2>Proof</h2>
      <div className="panel">
        <table>
          <tbody>
            <tr>
              <td>Solana tx</td>
              <td className="mono">
                {tx ? (
                  <a href={tx} target="_blank" rel="noreferrer">
                    {query.solanaTx}
                  </a>
                ) : (
                  "—"
                )}
              </td>
            </tr>
            <tr>
              <td>Request PDA</td>
              <td className="mono">{query.solanaReqPda ?? "—"}</td>
            </tr>
            <tr>
              <td>Buyer</td>
              <td className="mono">{truncateMiddle(query.buyer, 8)}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </>
  );
}
