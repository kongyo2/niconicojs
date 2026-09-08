import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    include: ["test/**/*.test.ts"],
    // Live tests reach the real APIs and are opt-in via NICONICO_LIVE=1.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
