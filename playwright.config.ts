import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  retries: 0,
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:4321",
    headless: true,
    // Deterministically produce test-results/ evidence on failure (for CI conditional upload).
    trace: "retain-on-failure",
  },
  webServer: {
    // Self-contained gate: build the Cloudflare worker and serve its assets locally,
    // never depending on leftover workspace output.
    command:
      "rm -rf dist .astro && MOMOKO_CONTENT_PACKAGE_MODE=test MOMOKO_CONTENT_PACKAGE_PREVIEW=1 MOMOKO_CONTENT_PACKAGE_ROOT=tests/fixtures/content-package/synthetic pnpm build && MOMOKO_CONTENT_PACKAGE_MODE=test MOMOKO_CONTENT_PACKAGE_PREVIEW=1 MOMOKO_CONTENT_PACKAGE_ROOT=tests/fixtures/content-package/synthetic pnpm build:post && pnpm exec wrangler dev dist/_worker.js --assets dist --local --ip 127.0.0.1 --port 4321 --compatibility-date 2026-08-08 --compatibility-flags nodejs_compat --var MOMOKO_REPO_ROOT:$PWD --var MOMOKO_CONTENT_PACKAGE_MODE:test --var MOMOKO_CONTENT_PACKAGE_PREVIEW:1 --var MOMOKO_CONTENT_PACKAGE_ROOT:tests/fixtures/content-package/synthetic",
    port: 4321,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
