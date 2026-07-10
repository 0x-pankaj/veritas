/**
 * Demo price simulation. Deterministic so the "liar caught by consensus"
 * moment is reproducible on every run (and in tests). Honest sellers land
 * within the coordinator's tolerance (100 bps); the liar sits well outside it.
 */
export const DEMO = {
  category: "crypto-prices" as const,
  symbol: "BTC/USD",
  /** Canonical mid used by the honest sellers. */
  basePrice: 50_000,
  /** Small honest disagreement, well inside the 100 bps tolerance. */
  honestOffsets: [0, 100] as const,
  /** Liar's poisoned value: +10%, far outside tolerance → flagged as outlier. */
  poisonMultiplier: 1.1,
};

/** Honest quote: base + a fixed per-seller offset (decimal string). */
export function honestQuote(offset: number): string {
  return (DEMO.basePrice + offset).toFixed(2);
}

/** Poisoned quote: base × poisonMultiplier (decimal string). */
export function poisonedQuote(): string {
  return (DEMO.basePrice * DEMO.poisonMultiplier).toFixed(2);
}
