import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./globals.css";

export const metadata: Metadata = {
  title: "Veritas — verified data for the agent economy",
  description:
    "An AI agent buys data from strangers and pays only for data that is provably correct — verified on Solana, settled in USDC on Circle Arc.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
