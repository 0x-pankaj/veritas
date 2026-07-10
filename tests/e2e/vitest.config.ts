import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Same web3.js post-test polling caveat as the other Devnet suites.
    dangerouslyIgnoreUnhandledErrors: true,
    testTimeout: 180_000,
    hookTimeout: 180_000,
  },
});
