import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @solana/web3.js background blockhash-polling promises can reject AFTER
    // devnet tests pass when the public devnet RPC times out (see coordinator).
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
