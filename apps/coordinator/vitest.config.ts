import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // @solana/web3.js keeps background blockhash-polling promises alive after
    // devnet tests complete; when the public devnet RPC times out, those
    // stray promises reject AFTER the test passed and would fail the file.
    // Test assertions still gate correctness — this only silences post-test
    // noise from third-party polling. Do not use this to hide real failures.
    dangerouslyIgnoreUnhandledErrors: true,
  },
});
