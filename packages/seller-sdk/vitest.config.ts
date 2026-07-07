import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same rationale as apps/coordinator: @solana/web3.js background
    // blockhash-polling promises can reject AFTER devnet tests pass when the
    // public devnet RPC times out. Assertions still gate correctness.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
