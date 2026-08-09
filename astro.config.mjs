// @ts-check
import { defineConfig } from "astro/config";

// Git canonical + 静态构建；无运行时 Worker/KV/D1（ADR-06）。唯一部署面为
// GitHub Actions Direct Upload（wrangler pages deploy），见 .github/workflows。
export default defineConfig({
  site: "https://momoko.pro",
  output: "static",
  trailingSlash: "ignore",
  build: {
    // 内容 hash 文件名 → 资产 immutable（§6.3 cache 失效契约）。
    assets: "_assets",
  },
});
