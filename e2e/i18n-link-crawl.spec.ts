import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Task #33 contract tests: BFS internal-link crawl + i18n route matrix.
 * Run against the built Cloudflare worker via the playwright webServer.
 */

const LOCALES = ["zh", "ja", "en"] as const;
type Locale = (typeof LOCALES)[number];

const SECTIONS = ["news", "encyclopedia", "songs-live", "anniversary", "about", "search"] as const;

const BASE = "http://localhost:4321";

/** Known static assets: never page routes. */
function isStaticAsset(pathname: string): boolean {
  if (pathname.startsWith("/_astro/") || pathname.startsWith("/assets/")) return true;
  if (pathname === "/favicon.ico" || pathname === "/momoko-logo.svg" || pathname === "/robots.txt") return true;
  return /\.(png|jpe?g|webp|gif|svg|avif|ico|woff2?|ttf|css|js|json|txt)$/u.test(pathname);
}

function isPageLink(href: string): boolean {
  if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
    return false;
  }
  return true;
}

function localeOf(pathname: string): Locale | undefined {
  const match = pathname.match(/^\/(zh|ja|en)(?=\/|$)/u);
  return match?.[1] as Locale | undefined;
}

async function collectLinks(page: Page): Promise<string[]> {
  return page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
  );
}

/** BFS over rendered internal links, asserting the task #33 contract on every edge. */
async function crawlSite(request: APIRequestContext, failOnBadLink: boolean): Promise<{ pages: number; links: number }> {
  const seen = new Set<string>();
  const queue: string[] = [];
  let linksChecked = 0;

  for (const locale of LOCALES) {
    const start = `/${locale}/`;
    seen.add(start);
    queue.push(start);
  }

  while (queue.length > 0) {
    const current = queue.shift()!;
    const response = await request.get(current, { maxRedirects: 3 });
    if (!response.ok()) {
      if (failOnBadLink) throw new Error(`crawl: ${current} returned ${response.status()}`);
      continue;
    }
    const finalUrl = new URL(response.url());
    const finalPath = finalUrl.pathname;
    if (finalUrl.origin !== BASE) throw new Error(`crawl: ${current} left the origin -> ${finalUrl}`);
    const pageLocale = localeOf(finalPath);
    if (!pageLocale) throw new Error(`crawl: ${current} resolved to unprefixed page ${finalPath}`);

    const html = await response.text();
    const hrefs = [...html.matchAll(/<a[^>]+href="([^"]+)"/gu)].map((m) =>
      (m[1] ?? "").replaceAll("&#38;", "&").replaceAll("&amp;", "&"),
    );
    linksChecked += hrefs.length;

    for (const rawHref of hrefs) {
      if (!isPageLink(rawHref)) continue;
      const target = new URL(rawHref, finalUrl);
      if (target.origin !== BASE) continue; // external links (e.g. official source) are out of crawl scope
      const pathname = target.pathname;
      if (isStaticAsset(pathname)) continue;
      const targetLocale = localeOf(pathname);
      if (targetLocale === undefined && pathname !== "/" && pathname !== "/locale-switch") {
        if (failOnBadLink) throw new Error(`crawl: unprefixed page link ${pathname} from ${finalPath}`);
        continue;
      }
      const normalized = `${pathname}${target.search}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      if (seen.size > 200) throw new Error("crawl: node budget exceeded");
      queue.push(normalized);
    }
  }

  return { pages: seen.size, links: linksChecked };
}

test("BFS crawl: all rendered internal links resolve, stay localized, same-origin, no prefix-less pages", async ({ request }) => {
  const result = await crawlSite(request, true);
  // Reach beyond top-level lists into leaf pages (news detail, etc.)
  expect(result.pages).toBeGreaterThan(12);
});

test("root negotiation: cookie > Accept-Language q-values > default ja; 3xx same-origin, no loop", async ({ request }) => {
  const cases: Array<{ headers: Record<string, string>; expected: string }> = [
    { headers: { Cookie: "momoko_locale=zh", "Accept-Language": "ja" }, expected: "/zh/" },
    { headers: { Cookie: "momoko_locale=en", "Accept-Language": "zh-CN,ja;q=0.8" }, expected: "/en/" },
    { headers: { "Accept-Language": "zh-CN;q=0.9,ja;q=0.5" }, expected: "/zh/" },
    { headers: { "Accept-Language": "ja;q=0.8,en;q=0.4" }, expected: "/ja/" },
    { headers: { "Accept-Language": "fr-FR,de;q=0.8" }, expected: "/ja/" },
    { headers: { Cookie: "momoko_locale=invalid", "Accept-Language": "en-US" }, expected: "/en/" },
    { headers: {}, expected: "/ja/" }, // no hints -> default ja
  ];
  for (const c of cases) {
    const response = await request.get("/", { maxRedirects: 0, headers: c.headers });
    expect(response.status(), `status for ${JSON.stringify(c.headers)}`).toBe(302);
    const location = response.headers().location ?? "";
    expect(location.startsWith(c.expected), `location for ${JSON.stringify(c.headers)}`).toBe(true);
    expect(location.startsWith("http")).toBe(false); // same-origin relative location
  }
});

test("legacy /search negotiates to /{lang}/search/ and never renders a hardcoded page", async ({ request }) => {
  const zh = await request.get("/search", { maxRedirects: 0, headers: { "Accept-Language": "zh-CN" } });
  expect(zh.status()).toBe(303);
  expect(zh.headers().location).toBe("/zh/search/");

  const ja = await request.get("/search", { maxRedirects: 0 });
  expect(ja.status()).toBe(303);
  expect(ja.headers().location).toBe("/ja/search/");
});

test("legacy /search preserves the query string through the negotiated redirect", async ({ request }) => {
  const withQuery = await request.get("/search?q=%E5%90%88%E6%88%90&page=2", {
    maxRedirects: 0,
    headers: { Cookie: "momoko_locale=en" },
  });
  expect(withQuery.status()).toBe(303);
  expect(withQuery.headers().location).toBe("/en/search/?q=%E5%90%88%E6%88%90&page=2");
});

test("middleware redirects ONLY the exact / and /search paths, nothing else", async ({ request }) => {
  const mustNotRedirect = ["/news/", "/about/", "/foo", "/search/", "/SEARCH", "/assets/x.png", "/favicon.ico", "/_astro/x.js"];
  for (const path of mustNotRedirect) {
    const response = await request.get(path, { maxRedirects: 0 });
    if (response.status() >= 300 && response.status() < 400) {
      const location = response.headers().location ?? "";
      expect(location.startsWith("/search") || location === "/", `${path} must not redirect to a search/locale seam`).toBe(false);
    }
  }
  // the two seams still redirect
  expect((await request.get("/", { maxRedirects: 0 })).status()).toBe(302);
  expect((await request.get("/search", { maxRedirects: 0 })).status()).toBe(303);
});

test("platform security header rules are intact (static asset responses)", async ({ request }) => {
  // _headers rules are applied at the platform edge; wrangler dev --local
  // applies them to static asset responses. The middleware chain itself never
  // touches headers — this proves the rules still load.
  const asset = await request.get("/momoko-logo.svg");
  expect(asset.headers()["x-frame-options"]).toBe("DENY");
  expect(asset.headers()["x-content-type-options"]).toBe("nosniff");
  expect(asset.headers()["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(asset.headers()["content-security-policy"]).toContain("default-src 'self'");
});

test("unknown paths return true 404 with language chosen from path", async ({ page, request }) => {
  const zh = await request.get("/zh/nope/", { maxRedirects: 0 });
  expect(zh.status()).toBe(404);
  await page.goto("/zh/nope/");
  await expect(page.locator("h1")).toHaveText("404");
  // 404 chrome follows the path language (zh): localized back-home nav
  await expect(page.locator("nav[aria-label='首页 / Home'] a[href='/zh/']")).toBeVisible();

  const ja = await request.get("/ja/nope/", { maxRedirects: 0 });
  expect(ja.status()).toBe(404);
});

test("site menu: identical six entries on home chapter index and inner-page global nav", async ({ page }) => {
  const hrefsFor = async (selector: string): Promise<string[]> =>
    page.locator(selector).evaluateAll((els) => els.map((el) => (el as HTMLAnchorElement).getAttribute("href") ?? ""));

  for (const locale of LOCALES) {
    await page.goto(`/${locale}/`);
    const homeHrefs = await hrefsFor("nav[data-nav-landmark='home-chapters'] a");
    expect(homeHrefs, `home chapters ${locale}`).toHaveLength(6);
    for (const section of SECTIONS) {
      expect(homeHrefs, `home chapters ${locale}`).toContain(`/${locale}/${section}/`);
    }

    await page.goto(`/${locale}/about/`);
    const navHrefs = await hrefsFor("header nav.lg\\:block a");
    expect(navHrefs, `inner nav ${locale}`).toHaveLength(6);
    for (const section of SECTIONS) {
      expect(navHrefs, `inner nav ${locale}`).toContain(`/${locale}/${section}/`);
    }
    // Source Policy stays footer-only
    await expect(page.locator(`header a[href='/${locale}/source-policy/']`)).toHaveCount(0);
    await expect(page.locator(`footer a[href='/${locale}/source-policy/']`)).toHaveCount(1);
  }
});

test("search form action is localized and search route exists per locale", async ({ page }) => {
  for (const locale of LOCALES) {
    await page.goto(`/${locale}/search/`);
    await expect(page.locator("form#site-search")).toHaveAttribute("action", `/${locale}/search`);
  }
});

test("canonical and hreflang point to exact localized siblings (home, list, detail, search)", async ({ page }) => {
  const samples: Array<{ path: string; lang: string }> = [
    { path: "/zh/", lang: "zh" },
    { path: "/ja/news/", lang: "ja" },
    { path: "/en/news/2026/S1-synth-2026-08-08-001/", lang: "en" },
    { path: "/zh/search/", lang: "zh" },
  ];
  for (const sample of samples) {
    await page.goto(sample.path);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://momoko.pro${sample.path}`,
    );
    for (const locale of LOCALES) {
      const sibling = sample.path.replace(new RegExp(`^/${sample.lang}`), `/${locale}`);
      await expect(
        page.locator(`link[rel="alternate"][hreflang="${locale}"]`),
        `hreflang ${locale} for ${sample.path}`,
      ).toHaveAttribute("href", `https://momoko.pro${sibling}`);
    }
  }
});

test("language switcher keeps the same localized path on home, list, detail and search (query preserved)", async ({ page }) => {
  const cases: Array<{ from: string; toLocale: string; expectedPath: string }> = [
    { from: "/zh/", toLocale: "ja", expectedPath: "/ja/" },
    { from: "/ja/news/", toLocale: "en", expectedPath: "/en/news/" },
    { from: "/zh/news/2026/S1-synth-2026-08-08-001/", toLocale: "en", expectedPath: "/en/news/2026/S1-synth-2026-08-08-001/" },
    { from: "/zh/search/?q=%E5%90%88%E6%88%90", toLocale: "en", expectedPath: "/en/search/?q=%E5%90%88%E6%88%90" },
  ];
  for (const c of cases) {
    await page.goto(c.from);
    const link = page.locator(`a[hreflang="${c.toLocale}"]`).first();
    await link.click();
    await expect(page).toHaveURL(new RegExp(c.expectedPath.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") + "$"));
  }
});

test("no unexpected prefix-less page links anywhere in rendered pages", async ({ page }) => {
  for (const locale of LOCALES) {
    await page.goto(`/${locale}/`);
    const hrefs = await collectLinks(page);
    for (const href of hrefs) {
      if (!isPageLink(href)) continue;
      const target = new URL(href, BASE);
      if (target.origin !== BASE) continue;
      if (isStaticAsset(target.pathname)) continue;
      // Every page link must be locale-prefixed; "/" and "/locale-switch" are
      // the two documented negotiation seams (root entry + language switch).
      if (
        target.pathname !== "/" &&
        target.pathname !== "/locale-switch" &&
        localeOf(target.pathname) === undefined
      ) {
        throw new Error(`unprefixed link ${target.pathname} on /${locale}/`);
      }
    }
  }
});
