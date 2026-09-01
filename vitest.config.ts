import { defineConfig, configDefaults } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    // *.e2e.test.ts files spawn the real CLI as a subprocess end-to-end —
    // valuable, but slow (the one that exists today takes ~4.5 minutes,
    // largely because it deliberately exercises the known, documented
    // runCheckWithGuards cancellation gap — see CLAUDE.md). Excluded from
    // the default `npm test`/`vitest run` so everyday iteration stays fast;
    // run explicitly via `npm run test:e2e`.
    exclude: [...configDefaults.exclude, "src/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});
