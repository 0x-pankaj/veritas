import Link from "next/link";
import { notFound } from "next/navigation";
import { getSeller } from "../../../src/data";
import { fmtPrice, fmtUsdc, truncateMiddle } from "../../../src/format";

export const dynamic = "force-dynamic";

export default async function SellerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getSeller(id);
  if (!detail) notFound();

  const { seller, earnings, accuracy, rounds } = detail;

  return (
    <>
      <p className="back">
        <Link href="/">← truth ledger</Link>
      </p>
      <h1>{seller.name}</h1>
      <p className="sub mono">{seller.solanaPubkey}</p>

      <div className="cards">
        <div className="card">
          <div className="label">Reputation</div>
          <div className="value">{seller.reputation}</div>
        </div>
        <div className="card">
          <div className="label">Accuracy</div>
          <div className="value">{accuracy === null ? "—" : `${accuracy}%`}</div>
        </div>
        <div className="card">
          <div className="label">Settled</div>
          <div className="value">{fmtUsdc(earnings.settled)}</div>
        </div>
        <div className="card">
          <div className="label">Pending</div>
          <div className="value">{fmtUsdc(earnings.pending)}</div>
        </div>
      </div>

      <div className="cards">
        <div className="card">
          <div className="label">Served</div>
          <div className="value">{seller.served}</div>
        </div>
        <div className="card">
          <div className="label">Matched</div>
          <div className="value">{seller.matched}</div>
        </div>
        <div className="card">
          <div className="label">Outliers</div>
          <div className="value">{seller.outliers}</div>
        </div>
        <div className="card">
          <div className="label">Stake</div>
          <div className="value">{fmtUsdc(seller.stake)}</div>
        </div>
      </div>

      <h2>Recent rounds</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Query</th>
              <th>Answer</th>
              <th>Truth</th>
              <th>Verdict</th>
              <th>Latency</th>
            </tr>
          </thead>
          <tbody>
            {rounds.length === 0 ? (
              <tr>
                <td colSpan={5} className="empty">
                  No rounds yet.
                </td>
              </tr>
            ) : (
              rounds.map((r) => (
                <tr key={r.queryId}>
                  <td className="mono">
                    <Link href={`/verify/${r.queryId}`}>{truncateMiddle(r.queryId, 8)}</Link>
                  </td>
                  <td className="num">{fmtPrice(r.value)}</td>
                  <td className="num">{fmtPrice(r.truth)}</td>
                  <td>
                    <span className={`pill ${r.matched ? "good" : "bad"}`}>
                      {r.matched ? "matched" : "outlier"}
                    </span>
                  </td>
                  <td className="num">{r.latencyMs} ms</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
