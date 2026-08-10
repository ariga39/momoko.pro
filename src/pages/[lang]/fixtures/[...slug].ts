import type { APIRoute } from "astro";

import { isLocale } from "../../../lib/locale.ts";

/**
 * Synthetic e2e-only crawl fixtures (task #33 BFS contract):
 *   /{lang}/fixtures/page.test.html — dotted-path HTML pages that the BFS
 *     crawl must fetch and treat as pages (content-type classification)
 *   /{lang}/fixtures/data/file.bin — non-HTML same-origin file NOT in the
 *     crawl KNOWN_ASSETS list; the crawl must request it and classify it as
 *     an asset edge by its response content-type
 * Served ONLY when the content package mode is "test" (the playwright
 * webServer sets MOMOKO_CONTENT_PACKAGE_MODE=test); any other build returns
 * 404, so these never exist in production.
 */

const MODE = import.meta.env.MOMOKO_CONTENT_PACKAGE_MODE;

const PAGE = (lang: string): string => `<!doctype html>
<html lang="${lang}">
  <head>
    <meta charset="utf-8" />
    <title>crawl fixture ${lang} (dotted path)</title>
    <link rel="canonical" href="https://momoko.pro/${lang}/fixtures/page.test.html" />
    <link rel="alternate" hreflang="zh" href="https://momoko.pro/zh/fixtures/page.test.html" />
    <link rel="alternate" hreflang="ja" href="https://momoko.pro/ja/fixtures/page.test.html" />
    <link rel="alternate" hreflang="en" href="https://momoko.pro/en/fixtures/page.test.html" />
  </head>
  <body>
    <h1>crawl fixture ${lang}</h1>
    <p>Synthetic e2e-only page with a dotted path segment; the BFS crawl must
    fetch it and treat it as an HTML page.</p>
    <ul>
      <li><a href="/zh/fixtures/page.test.html">zh</a></li>
      <li><a href="/ja/fixtures/page.test.html">ja</a></li>
      <li><a href="/en/fixtures/page.test.html">en</a></li>
      <li><a href="/${lang}/fixtures/data/file.bin">binary fixture</a></li>
    </ul>
  </body>
</html>
`;

const BIN = "crawl fixture: non-HTML same-origin file, intentionally not in the crawl KNOWN_ASSETS list. The BFS must request it and classify it as an asset edge by response content-type (application/octet-stream), never reject it at enqueue time.";

export const prerender = false;

export const GET: APIRoute = ({ params }) => {
  if (MODE !== "test") {
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const rawLang = params.lang;
  if (!isLocale(rawLang)) {
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
  const lang: string = rawLang;
  const rawSlug = params.slug ?? [];
  const slug = Array.isArray(rawSlug) ? rawSlug.join("/") : String(rawSlug);
  if (slug === "page.test.html") {
    return new Response(PAGE(lang), {
      status: 200,
      headers: { "content-type": "text/html; charset=utf-8" },
    });
  }
  if (slug === "data/file.bin") {
    return new Response(BIN, {
      status: 200,
      headers: { "content-type": "application/octet-stream" },
    });
  }
  return new Response("not found", { status: 404, headers: { "content-type": "text/plain; charset=utf-8" } });
};
