import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veritas — dashboard & truth ledger",
  description:
    "Seller earnings and reputation, plus a public explorer of on-chain consensus verdicts.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="wrap">
          <nav className="nav">
            <Link href="/" className="brand">
              Veritas
            </Link>
            <Link href="/">Explorer</Link>
            <Link href="/docs">Docs</Link>
            <a
              href="https://github.com/0x-pankaj/veritas"
              target="_blank"
              rel="noreferrer"
            >
              GitHub
            </a>
            <span className="muted">verified data · Solana truth · USDC on Arc</span>
          </nav>
          {children}
        </div>
      </body>
    </html>
  );
}
