import { defineConfig } from "vitest/config";

/**
 * Config for `npm run test:e2e` — the slow, real-subprocess CLI tests
 * (`*.e2e.test.ts`) that the default `vitest.config.ts` deliberately
 * excludes so everyday `npm test` stays fast. See that file's own comment
 * for why (the one that exists today takes ~4.5 minutes).
 */
export default defineConfig({
  test: {
    include: ["src/**/*.e2e.test.ts"],
    testTimeout: 300_000,
    hookTimeout: 60_000,
  },
});
