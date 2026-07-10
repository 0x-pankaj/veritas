import Link from "next/link";
import { listSellers, listVerdicts } from "../src/data";
import { fmtPrice, fmtUsdc, solscanTx, truncateMiddle } from "../src/format";

export const dynamic = "force-dynamic";

function StatusPill({ status }: { status: string }) {
  const cls =
    status === "DONE"
      ? "good"
      : status === "FAILED"
        ? "bad"
        : status === "SETTLED_ONCHAIN"
          ? "warn"
          : "muted";
  return <span className={`pill ${cls}`}>{status.toLowerCase()}</span>;
}

export default async function Home() {
  const [sellers, verdicts] = await Promise.all([listSellers(), listVerdicts(25)]);

  return (
    <>
      <h1>Truth ledger</h1>
      <p className="sub">
        Every verified purchase records a public verdict on Solana: the consensus
        truth and which sellers matched it. Accuracy is monetized — winners are
        paid in USDC on Arc; liars earn nothing.
      </p>

      <h2>Sellers</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Seller</th>
              <th>Reputation</th>
              <th>Accuracy</th>
              <th>Rounds</th>
              <th>Earnings</th>
              <th>Stake</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {sellers.length === 0 ? (
              <tr>
                <td colSpan={7} className="empty">
                  No sellers registered yet.
                </td>
              </tr>
            ) : (
              sellers.map((s) => (
                <tr key={s.id}>
                  <td>
                    <Link href={`/sellers/${s.id}`}>{s.name}</Link>
                  </td>
                  <td className="num">{s.reputation}</td>
                  <td className="num">{s.accuracy === null ? "—" : `${s.accuracy}%`}</td>
                  <td className="num">
                    {s.matched}/{s.served}
                  </td>
                  <td className="num">{fmtUsdc(s.earnings.total)}</td>
                  <td className="num">{fmtUsdc(s.stake)}</td>
                  <td>
                    <span className={`pill ${s.status === "ACTIVE" ? "good" : "muted"}`}>
                      {s.status.toLowerCase()}
                    </span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <h2>Recent verdicts</h2>
      <div className="panel">
        <table>
          <thead>
            <tr>
              <th>Query</th>
              <th>Truth</th>
              <th>K</th>
              <th>Cost</th>
              <th>Status</th>
              <th>Solana</th>
            </tr>
          </thead>
          <tbody>
            {verdicts.length === 0 ? (
              <tr>
                <td colSpan={6} className="empty">
                  No verdicts yet — run a verified purchase.
                </td>
              </tr>
            ) : (
              verdicts.map((v) => {
                const tx = solscanTx(v.solanaTx);
                return (
                  <tr key={v.id}>
                    <td className="mono">
                      <Link href={`/verify/${v.id}`}>{truncateMiddle(v.id, 8)}</Link>
                    </td>
                    <td className="num">{fmtPrice(v.truth)}</td>
                    <td className="num">{v.k}</td>
                    <td className="num">{fmtUsdc(v.cost)}</td>
                    <td>
                      <StatusPill status={v.status} />
                    </td>
                    <td className="mono">
                      {tx ? (
                        <a href={tx} target="_blank" rel="noreferrer">
                          {truncateMiddle(v.solanaTx, 6)}
                        </a>
                      ) : (
                        "—"
                      )}
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
