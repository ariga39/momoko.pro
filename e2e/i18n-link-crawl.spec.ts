import { expect, test, type Page, type APIRequestContext } from "@playwright/test";

/**
 * Task #33 contract tests: BFS internal-link crawl + i18n route matrix.
 * Run against the built Cloudflare worker via the playwright webServer.
 */

const LOCALES = ["zh", "ja", "en"] as const;
type Locale = (typeof LOCALES)[number];

const SECTIONS = ["news", "encyclopedia", "songs-live", "anniversary", "about", "search"] as const;

const BASE = "http://localhost:4321";
const SITE_ORIGINS = new Set([BASE, "https://momoko.pro"]);

function assertSiteOrigin(url: URL, what: string): void {
  if (!SITE_ORIGINS.has(url.origin)) throw new Error(`crawl: ${what} leaves site origin -> ${url.origin}`);
}

/**
 * Explicit known asset roots / files. NO suffix-based rules: anything not
 * listed here is fetched and classified by its same-origin response
 * content-type, so a page-shaped URL with a dot-extension can never be
 * silently skipped.
 */
const KNOWN_ASSETS = new Set([
  "/_astro/", // hashed build assets
  "/assets/", // static asset root
  "/favicon.ico",
  "/momoko-logo.svg",
  "/robots.txt",
  "/manifest.json", // API-ish JSON endpoint, not a page
]);

function isKnownAsset(pathname: string): boolean {
  return [...KNOWN_ASSETS].some((root) => (root.endsWith("/") ? pathname.startsWith(root) : pathname === root));
}

function isNavigationHref(href: string): boolean {
  if (href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:") || href.startsWith("javascript:")) {
    return false;
  }
  return true;
}

function localeOf(pathname: string): Locale | undefined {
  const match = pathname.match(/^\/(zh|ja|en)(?=\/|$)/u);
  return match?.[1] as Locale | undefined;
}

function decodeEntities(value: string): string {
  return value.replaceAll("&#38;", "&").replaceAll("&amp;", "&");
}

function isNewsDetailPath(pathname: string): boolean {
  return /^\/[a-z]{2}\/news\/\d{4}\//u.test(pathname);
}

/** identity suffix of a news detail path (year + slug), e.g. "2026/S1-...-001/" */
function newsIdentitySuffix(pathname: string): string {
  const match = pathname.match(/^\/[a-z]{2}\/news\/(.+)$/u);
  return match?.[1] ?? "";
}

/** parse alternate <link> entries from html: [{hreflang, path}] (x-default excluded) */
function parseAlternates(html: string, baseUrl: URL): Array<{ hreflang: string; path: string }> {
  const out: Array<{ hreflang: string; path: string }> = [];
  for (const match of html.matchAll(/<link[^>]+rel="alternate"[^>]+hreflang="([^"]+)"[^>]*href="([^"]+)"[^>]*>/gu)) {
    const hreflang = match[1] ?? "";
    const rawHref = match[2] ?? "";
    if (hreflang === "x-default") continue;
    out.push({ hreflang, path: new URL(decodeEntities(rawHref), baseUrl).pathname });
  }
  return out;
}

async function collectLinks(page: Page): Promise<string[]> {
  return page.locator("a[href]").evaluateAll((anchors) =>
    anchors.map((a) => (a as HTMLAnchorElement).getAttribute("href") ?? ""),
  );
}

interface CrawlResult {
  pages: number;
  edges: number;
  forms: number;
  assets: number;
  canonicalChecks: number;
  hreflangChecks: number;
}

/**
 * BFS over rendered internal links. For every visited HTML page:
 *   - status 200 (or documented same-origin 3xx followed to 200), same-origin
 *   - page path is locale-prefixed (no unexpected prefix-less pages)
 *   - canonical: same-origin, locale-prefixed, fetches 200
 *   - every hreflang alternate: hreflang in {zh,ja,en}, unique, matches the
 *     URL's locale prefix, same-origin, fetches 200; non-content pages require
 *     EXACT localized siblings and a self-canonical URL; news detail pages
 *     require a consistent content identity (same year/slug suffix across
 *     canonical + alternates, and every member reciprocally emits the same
 *     alternate set)
 *   - every form[action]: same-origin localized path
 * Asset classification happens AFTER the request, by same-origin response
 * content-type: text/html => page; anything else => asset edge (recorded, not
 * crawled). No suffix-based exclusions beyond the explicit KNOWN_ASSETS list.
 */
async function crawlSite(request: APIRequestContext, failOnBadLink: boolean): Promise<CrawlResult> {
  const seen = new Set<string>();
  const queue: string[] = [];
  const result: CrawlResult = { pages: 0, edges: 0, forms: 0, assets: 0, canonicalChecks: 0, hreflangChecks: 0 };

  for (const locale of LOCALES) {
    const start = `/${locale}/`;
    seen.add(start);
    queue.push(start);
  }
  // Synthetic classification fixtures (test-mode endpoint only): a dotted-path
  // HTML page that must be crawled as a page, and a non-HTML file (not in
  // KNOWN_ASSETS) that must be classified as an asset edge by content-type.
  for (const seed of ["/zh/fixtures/page.test.html", "/zh/fixtures/data/file.bin"]) {
    seen.add(seed);
    queue.push(seed);
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
    const contentType = response.headers()["content-type"] ?? "";
    if (!contentType.includes("text/html")) {
      result.assets += 1; // asset edge classified by response content-type
      continue;
    }
    const pageLocale = localeOf(finalPath);
    if (!pageLocale) throw new Error(`crawl: ${current} resolved to unprefixed page ${finalPath}`);
    result.pages += 1;

    const html = await response.text();

    // --- per-page SEO contract ---
    const canonical = html.match(/<link[^>]+rel="canonical"[^>]*>/u)?.[0];
    const canonicalHref = canonical?.match(/href="([^"]+)"/u)?.[1];
    if (!canonicalHref) throw new Error(`crawl: ${finalPath} has no canonical`);
    const canonicalUrl = new URL(decodeEntities(canonicalHref), finalUrl);
    assertSiteOrigin(canonicalUrl, `canonical of ${finalPath}`);
    if (localeOf(canonicalUrl.pathname) === undefined) throw new Error(`crawl: ${finalPath} canonical is unprefixed`);
    const canonicalRes = await request.get(canonicalUrl.pathname, { maxRedirects: 3 });
    if (!canonicalRes.ok()) throw new Error(`crawl: canonical of ${finalPath} -> ${canonicalRes.status()}`);
    result.canonicalChecks += 1;

    const alternates = parseAlternates(html, finalUrl);
    if (alternates.length === 0) throw new Error(`crawl: ${finalPath} has no hreflang alternates`);
    const seenHreflangs = new Set<string>();
    for (const alt of alternates) {
      if (!(LOCALES as readonly string[]).includes(alt.hreflang)) {
        throw new Error(`crawl: ${finalPath} hreflang ${alt.hreflang} not in zh/ja/en`);
      }
      if (seenHreflangs.has(alt.hreflang)) throw new Error(`crawl: ${finalPath} duplicate hreflang ${alt.hreflang}`);
      seenHreflangs.add(alt.hreflang);
      if (localeOf(alt.path) !== alt.hreflang) {
        throw new Error(`crawl: ${finalPath} hreflang ${alt.hreflang} does not match URL locale ${alt.path}`);
      }
      const altRes = await request.get(alt.path, { maxRedirects: 3 });
      if (!altRes.ok()) throw new Error(`crawl: hreflang ${alt.hreflang} of ${finalPath} -> ${altRes.status()}`);
      result.hreflangChecks += 1;
    }

    if (isNewsDetailPath(finalPath)) {
      // Content identity closure: canonical + all alternates keep the same
      // year/slug suffix, and every member reciprocally emits the same set.
      const identity = newsIdentitySuffix(finalPath);
      if (newsIdentitySuffix(canonicalUrl.pathname) !== identity) {
        throw new Error(`crawl: ${finalPath} canonical identity mismatch ${canonicalUrl.pathname}`);
      }
      const memberPaths = new Set([canonicalUrl.pathname, ...alternates.map((alt) => alt.path)]);
      for (const member of memberPaths) {
        if (newsIdentitySuffix(member) !== identity) {
          throw new Error(`crawl: ${finalPath} identity member mismatch ${member}`);
        }
        const memberRes = await request.get(member, { maxRedirects: 3 });
        if (!memberRes.ok()) throw new Error(`crawl: identity member ${member} -> ${memberRes.status()}`);
        const memberSet = new Set(parseAlternates(await memberRes.text(), finalUrl).map((alt) => alt.path));
        if (![...memberSet].every((p) => memberPaths.has(p)) || ![...memberPaths].every((p) => memberSet.has(p))) {
          throw new Error(`crawl: ${finalPath} non-reciprocal identity set at ${member}`);
        }
      }
    } else {
      // Non-content pages mirror the page's own path across all three locales.
      if (canonicalUrl.pathname !== finalPath) throw new Error(`crawl: ${finalPath} not self-canonical`);
      for (const other of LOCALES) {
        const sibling = finalPath.replace(`/${pageLocale}`, `/${other}`);
        if (!seenHreflangs.has(other)) throw new Error(`crawl: ${finalPath} missing hreflang ${other}`);
        if (!alternates.some((alt) => alt.path === sibling)) {
          throw new Error(`crawl: ${finalPath} hreflang ${other} != exact sibling ${sibling}`);
        }
      }
    }

    // --- form actions that navigate must be localized ---
    const forms = [...html.matchAll(/<form[^>]*>/gu)].map((m) => m[0]);
    result.forms += forms.length;
    for (const form of forms) {
      const action = form.match(/action="([^"]+)"/u)?.[1];
      if (action === undefined) continue; // no action = same-URL submission, still local
      const actionUrl = new URL(decodeEntities(action), finalUrl);
      if (actionUrl.origin !== BASE) throw new Error(`crawl: ${finalPath} form leaves origin`);
      if (localeOf(actionUrl.pathname) === undefined) {
        throw new Error(`crawl: ${finalPath} form action is unprefixed: ${actionUrl.pathname}`);
      }
    }

    // --- crawl edges: enqueue EVERY non-known-asset same-origin link; the
    // content-type classification happens when the node is fetched ---
    const hrefs = [...html.matchAll(/<a[^>]+href="([^"]+)"/gu)].map((m) => decodeEntities(m[1] ?? ""));
    result.edges += hrefs.length;

    for (const rawHref of hrefs) {
      if (!isNavigationHref(rawHref)) continue;
      const target = new URL(rawHref, finalUrl);
      if (target.origin !== BASE) continue; // external links are out of crawl scope
      if (isKnownAsset(target.pathname)) continue;
      const normalized = `${target.pathname}${target.search}`;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      if (seen.size > 300) throw new Error("crawl: node budget exceeded");
      queue.push(normalized);
    }
  }

  return result;
}

test("BFS crawl: all rendered internal links resolve, stay localized, same-origin, no prefix-less pages", async ({ request }) => {
  const result = await crawlSite(request, true);
  // Reach beyond top-level lists into leaf pages (news detail, etc.)
  expect(result.pages).toBeGreaterThan(12);
  expect(result.edges).toBeGreaterThan(40);
  expect(result.forms).toBeGreaterThan(0);
  // dotted-path HTML fixture was crawled as a page; non-HTML fixture was
  // classified as an asset edge by content-type (both seeded in crawlSite)
  expect(result.assets).toBeGreaterThan(0);
  console.log(`BFS: pages=${result.pages} edges=${result.edges} forms=${result.forms} assets=${result.assets} canonicalChecks=${result.canonicalChecks} hreflangChecks=${result.hreflangChecks}`);
});

test("root negotiation: cookie > Accept-Language q-values > default ja; exact location, one-hop terminal 200", async ({ request }) => {
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
    expect(location, `location for ${JSON.stringify(c.headers)}`).toBe(c.expected);
    expect(location.startsWith("http")).toBe(false); // same-origin relative location
    // one hop must land on a terminal 200 with no further 3xx
    const terminal = await request.get(location, { maxRedirects: 3 });
    expect(terminal.status(), `terminal for ${JSON.stringify(c.headers)}`).toBe(200);
    expect(new URL(terminal.url()).pathname).toBe(c.expected);
  }
});

test("legacy /search negotiates with exact location, query preserved, terminal 200", async ({ request }) => {
  const cases: Array<{ headers: Record<string, string>; path: string; expected: string }> = [
    { headers: { "Accept-Language": "zh-CN" }, path: "/search", expected: "/zh/search/" },
    { headers: {}, path: "/search", expected: "/ja/search/" },
    { headers: { Cookie: "momoko_locale=en" }, path: "/search?q=%E5%90%88%E6%88%90&page=2", expected: "/en/search/?q=%E5%90%88%E6%88%90&page=2" },
  ];
  for (const c of cases) {
    const response = await request.get(c.path, { maxRedirects: 0, headers: c.headers });
    expect(response.status(), `${c.path}`).toBe(303);
    expect(response.headers().location, `${c.path}`).toBe(c.expected);
    const terminal = await request.get(c.expected, { maxRedirects: 3 });
    expect(terminal.status(), `terminal ${c.path}`).toBe(200);
  }
});

test("middleware redirects ONLY the exact / and /search paths; everything else is non-3xx", async ({ request }) => {
  // Paths that must NOT be a 3xx negotiation redirect (200/204/404 allowed)
  const mustNotRedirect = ["/news/", "/about/", "/foo", "/search/", "/SEARCH", "/assets/x.png", "/favicon.ico", "/_astro/x.js"];
  for (const path of mustNotRedirect) {
    const response = await request.get(path, { maxRedirects: 0 });
    const status = response.status();
    expect(status >= 300 && status < 400, `${path} must not be 3xx (got ${status})`).toBe(false);
    expect([200, 204, 404].includes(status), `${path} unexpected status ${status}`).toBe(true);
  }
  // the two seams still redirect with exact locations
  const root = await request.get("/", { maxRedirects: 0 });
  expect(root.status()).toBe(302);
  const search = await request.get("/search", { maxRedirects: 0 });
  expect(search.status()).toBe(303);
  expect(search.headers().location).toBe("/ja/search/");
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
      if (!isNavigationHref(href)) continue;
      const target = new URL(href, BASE);
      if (target.origin !== BASE) continue;
      if (isKnownAsset(target.pathname)) continue;
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
