/** USDC 6-decimal base units → "$0.0103". Sub-dollar amounts show 4 dp. */
export function fmtUsdc(baseUnits: string | null | undefined): string {
  if (!baseUnits) return "$0.00";
  const n = Number(baseUnits) / 1e6;
  return `$${n.toFixed(n !== 0 && Math.abs(n) < 1 ? 4 : 2)}`;
}

const DECIMAL = /^-?\d+(\.\d+)?$/;

/** A dollar price string like "50100" → "$50,100.00" (verdict truth). A hash
 *  truth (content-addressed mode) is passed through unchanged. */
export function fmtPrice(value: string | null | undefined): string {
  if (value == null || value === "") return "—";
  if (!DECIMAL.test(value.trim())) return value; // hash / non-numeric truth
  const n = Number(value);
  return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Short hex/base58 for display: "AbCd…WxYz". */
export function truncateMiddle(s: string | null | undefined, edge = 6): string {
  if (!s) return "—";
  if (s.length <= edge * 2 + 1) return s;
  return `${s.slice(0, edge)}…${s.slice(-edge)}`;
}

/** Solana explorer URL for a devnet signature (null-safe). */
export function solscanTx(tx: string | null | undefined): string | null {
  if (!tx) return null;
  return `https://explorer.solana.com/tx/${tx}?cluster=devnet`;
}
