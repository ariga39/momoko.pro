import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:4321",
    headless: true,
  },
  webServer: {
    command: "pnpm exec astro preview --port 4321",
    port: 4321,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
