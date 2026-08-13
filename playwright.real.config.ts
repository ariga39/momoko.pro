import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  testMatch: ["final-real-content.spec.ts"],
  timeout: 120_000,
  retries: 0,
  outputDir: "test-results-real",
  use: {
    baseURL: "http://localhost:4321",
    headless: true,
    // Deterministically produce test-results/ evidence on failure (for CI conditional upload).
    trace: "retain-on-failure",
  },
  webServer: {
    // Self-contained gate: build the production worker with the real content
    // package (PUBLIC_BUILD=1 → dist-public) and serve it locally, never
    // depending on leftover workspace output or the synthetic fixture.
    command:
      "scripts/clean-real-e2e-output.sh && PUBLIC_BUILD=1 pnpm build:public && pnpm exec wrangler dev dist-public/_worker.js --assets dist-public --local --ip 127.0.0.1 --port 4321 --compatibility-date 2026-08-08 --compatibility-flags nodejs_compat --var MOMOKO_REPO_ROOT:$PWD",
    port: 4321,
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
