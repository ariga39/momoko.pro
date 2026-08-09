// @ts-check
import { execSync } from "node:child_process";
import { defineConfig } from "astro/config";

// Git canonical + 静态构建；无运行时 Worker/KV/D1（ADR-06）。
// i18n（design.md §1.2）：Astro 原生 i18n routing + Paraglide UI catalog。
// / 为显式 x-default 语言选择页；不启用浏览器 Accept-Language 自动跳转。
export default defineConfig({
  site: "https://momoko.pro",
  output: "static",
  trailingSlash: "ignore",
  i18n: {
    locales: ["ja", "zh", "en"],
    defaultLocale: "ja",
    routing: {
      prefixDefaultLocale: true,
      redirectToDefaultLocale: false,
    },
  },
  build: {
    // 内容 hash 文件名 → 资产 immutable（§6.3 cache 失效契约）。
    assets: "_assets",
  },
  vite: {
    plugins: [
      {
        name: "paraglide-compile",
        buildStart() {
          execSync(
            "npx @inlang/paraglide-js compile --project ./project.inlang --outdir ./src/paraglide",
            { stdio: "inherit", cwd: process.cwd() },
          );
        },
      },
    ],
  },
});
