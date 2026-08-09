import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  outputDir: "test-results",
  use: {
    baseURL: "http://localhost:4321",
    headless: true,
    // Deterministically produce test-results/ evidence on failure (for CI conditional upload).
    trace: "retain-on-failure",
  },
  webServer: {
    // Self-contained gate: full static build + postbuild from an empty dist before preview,
    // never depending on leftover workspace dist.
    command:
      "rm -rf dist .astro && pnpm build && pnpm build:post && pnpm exec astro preview --port 4321",
    port: 4321,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
