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
    // 自包含门：从空 dist 完成静态 build + postbuild 再 preview，绝不依赖工作区残留 dist。
    command:
      "rm -rf dist .astro && pnpm build && pnpm build:post && pnpm exec astro preview --port 4321",
    port: 4321,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
