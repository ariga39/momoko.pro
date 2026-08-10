import { expect, test } from "@playwright/test";

test("root negotiates a localized home on the server", async ({ page }) => {
  const zh = await page.request.get("/", {
    maxRedirects: 0,
    headers: { "Accept-Language": "zh-CN,ja;q=0.8" },
  });
  expect(zh.status()).toBe(302);
  expect(zh.headers().location).toBe("/zh/");

  const cookieWins = await page.request.get("/", {
    maxRedirects: 0,
    headers: { Cookie: "momoko_locale=en", "Accept-Language": "zh-CN" },
  });
  expect(cookieWins.status()).toBe(302);
  expect(cookieWins.headers().location).toBe("/en/");

  const unsupported = await page.request.get("/", {
    maxRedirects: 0,
    headers: { "Accept-Language": "fr-FR,de;q=0.8" },
  });
  expect(unsupported.status()).toBe(302);
  expect(unsupported.headers().location).toBe("/ja/");
});

test("explicit localized URLs stay canonical and never negotiate again", async ({ page }) => {
  const response = await page.request.get("/zh/", { maxRedirects: 0 });
  expect(response.status()).toBe(200);
  await page.goto("/zh/");
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/",
  );
});

test("locale home keeps stable folio content separate from dynamic news fixtures", async ({ page }) => {
  await page.goto("/zh/");
  await expect(page.locator("h1")).toContainText("周防");
  await expect(page.locator("[data-home-v05] .folio-chapter")).toContainText("桃子是谁？");
  await expect(page.locator("[data-home-v05] .chapter-index")).toContainText("STORIES");
  await expect(page.locator("[data-home-v05] .home-notes")).toHaveCount(0);
  await expect(page.locator("[data-home-v05] .folio-song-card")).toBeVisible();
  await expect(page.locator("main")).not.toContainText("DEMO");
  await expect(page.locator("main")).not.toContainText("Latest notes");
  await expect(page.locator("main")).not.toContainText("夏フェス開催");
  await expect(page.locator("main")).not.toContainText("S1-synth-2026-08-08-002");
  await expect(page.locator("main")).not.toContainText("S1-synth-2026-08-08-003");
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/",
  );
});

test("news detail page renders translated body and marks fallback when missing", async ({ page }) => {
  await page.goto("/zh/news/2026/S1-synth-2026-08-08-001/");
  await expect(page.locator("h1")).toContainText("夏フェス開催");
  await expect(page.locator("article")).toContainText("合成夹具正文");
  // real translation page: self canonical, not noindex
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/zh/news/2026/S1-synth-2026-08-08-001/",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);

  await page.goto("/zh/news/2026/S1-synth-2026-08-08-002/");
  await expect(page.locator("article")).toContainText("合成フィクスチャ本文");
  await expect(page.locator("body")).toContainText("缺译");
  // fallback page: noindex,follow + canonical to source language
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-002/",
  );
});

test("search page filters the deterministic local index client-side", async ({ page }) => {
  // negotiation to the localized route is covered in i18n-link-crawl.spec.ts
  // with explicit headers; here we exercise the localized page itself.
  await page.goto("/ja/search/");
  const input = page.locator("#q");
  const results = page.locator("#results li");
  await expect(page.locator("form#site-search")).toHaveAttribute("action", "/ja/search");
  await input.fill("合成");
  // Draft records remain available to the review workflow but do not enter
  // public search/build indexes; only the reviewed fixture has three locale rows.
  await expect(results).toHaveCount(3);
  await expect(results.first()).toContainText("S1-synth-2026-08-08-001");
});

test("retracted news has no public detail body and is absent from the public manifest", async ({ page }) => {
  await page.goto("/zh/news/2026/S1-synth-2026-08-08-003/");
  await expect(page.locator("h1")).toHaveText("404");
  await expect(page.locator("body")).not.toContainText("撤回合成正文不得公开");

  const response = await page.request.get("/manifest.json");
  expect(response.ok()).toBe(true);
  const manifest = (await response.json()) as { entries: Array<{ source_item_id: string; review_status: string }> };
  const ids = manifest.entries.map((entry) => entry.source_item_id);
  expect(ids).toContain("synth-2026-08-08-001");
  expect(ids).not.toContain("synth-2026-08-08-002");
  expect(ids).not.toContain("synth-2026-08-08-003");
  expect(manifest.entries.find((entry) => entry.source_item_id === "synth-2026-08-08-001")?.review_status).toBe("published");
});

test("about and source-policy routes exist for each language", async ({ page }) => {
  for (const lang of ["zh", "ja", "en"]) {
    await page.goto(`/${lang}/about/`);
    await expect(page.locator("h1")).toBeVisible();
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
      "href",
      `https://momoko.pro/${lang}/about/`,
    );
    await page.goto(`/${lang}/source-policy/`);
    await expect(page.locator("h1")).toBeVisible();
  }
});

test("unknown route returns a real 404 with language from path (prefixed) or negotiation (unprefixed)", async ({ page, request }) => {
  const zh = await request.get("/zh/nope/", { maxRedirects: 0 });
  expect(zh.status()).toBe(404);
  await page.goto("/zh/nope/");
  await expect(page.locator("h1")).toHaveText("404");
  await expect(page.locator("nav[aria-label='首页 / Home'] a[href='/zh/']")).toBeVisible();

  // no cookie/header hints -> default ja chrome
  const ja = await request.get("/definitely-not-a-page/", { maxRedirects: 0 });
  expect(ja.status()).toBe(404);
  expect(await ja.text()).toContain("ホーム / Home");
  // any browser locale still renders a valid localized 404
  await page.goto("/definitely-not-a-page/");
  await expect(page.locator("h1")).toHaveText("404");
});

test("homepage keeps chapter navigation independent while desktop global nav stays on inner pages", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/zh/");
  await expect(page.locator("img.masthead-logo")).toHaveAttribute("src", "/momoko-logo.svg");
  await expect(page.locator("header nav[aria-label='主导航']")).toHaveCount(0);
  await expect(page.locator("nav[data-nav-landmark='home-chapters']")).toBeVisible();
  await expect(page.locator("nav[data-nav-landmark='home-chapters'] a")).toHaveCount(6);

  await page.setViewportSize({ width: 375, height: 900 });
  await page.goto("/zh/");
  await expect(page.locator("details[data-mobile-menu]")).toBeVisible();
  await page.locator("details[data-mobile-menu] summary").click();
  await expect(page.locator("details[data-mobile-menu] nav[aria-label='主导航 mobile']")).toBeVisible();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/zh/about/");
  await expect(page.locator("header nav[aria-label='主导航']")).toBeVisible();
});

test("navigation is keyboard-accessible: skip link + focusable nav links", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/zh/");
  await expect(page.locator("a.skip-link")).toHaveAttribute("href", "#main");
  const chapters = page.locator("nav[data-nav-landmark='home-chapters']");
  await expect(chapters).toBeVisible();
  await chapters.locator("a").first().focus();
  await expect(chapters.locator("a").first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(chapters.locator("a").nth(1)).toBeFocused();
});

test("language switcher navigates between locales", async ({ page }) => {
  await page.goto("/zh/");
  const switchLink = page.locator("nav[aria-label='语言切换 / Language switcher'] a[hreflang='ja']");
  await expect(switchLink).toHaveAttribute("href", /locale-switch\?locale=ja/);
  await switchLink.click();
  await expect(page).toHaveURL(/\/ja\//);
  await expect(page.locator("h1")).toContainText("周防");
  await expect(page.locator("[data-home-v05] .folio-chapter")).toContainText("桃子ってどんなアイドル？");

  const cookie = (await page.context().cookies()).find((item) => item.name === "momoko_locale");
  expect(cookie).toMatchObject({ value: "ja", path: "/", httpOnly: true, sameSite: "Lax" });
});

test("language switch keeps the current detail slug and rejects open redirects", async ({ page }) => {
  await page.goto("/zh/news/2026/S1-synth-2026-08-08-001/");
  await page.locator("nav[aria-label='语言切换 / Language switcher'] a[hreflang='en']").click();
  await expect(page).toHaveURL(/\/en\/news\/2026\/S1-synth-2026-08-08-001\//);

  const rejected = await page.request.get(
    "/locale-switch?locale=en&next=https%3A%2F%2Fevil.example%2F",
    { maxRedirects: 0 },
  );
  expect(rejected.status()).toBe(400);
  expect(rejected.headers()["set-cookie"]).toBeUndefined();
});

test("UI chrome renders in each page locale (Paraglide pinned to route)", async ({ page }) => {
  await page.goto("/en/about/");
  await expect(page.locator("h1")).toHaveText("About momoko.pro");
  await expect(page).toHaveTitle(/About momoko\.pro/);
  await expect(page.locator("nav[aria-label='Main navigation']")).toContainText("Stories");
  await expect(page.locator("nav[aria-label='Main navigation']")).toContainText("Anniversaries");
  await expect(page.locator("nav[aria-label='Main navigation']")).not.toContainText("Source Policy");
  await expect(page.locator("footer a[href='/en/source-policy/']")).toHaveText("Source Policy");
  await expect(page.locator("nav[aria-label='Language switcher']")).toBeVisible();
  await expect(page.locator("body")).toContainText("unofficial fan site");
  await expect(page.locator("body")).not.toContainText("editorial desk");
  await expect(page.locator("body")).not.toContainText("049");

  await page.goto("/zh/about/");
  await expect(page.locator("h1")).toHaveText("关于 momoko.pro");
  await expect(page.locator("nav[aria-label='主导航']")).toContainText("故事");
  await expect(page.locator("nav[aria-label='语言切换 / Language switcher']")).toBeVisible();

  await page.goto("/ja/about/");
  await expect(page.locator("h1")).toHaveText("momoko.pro について");
  await expect(page.locator("nav[aria-label='メインナビゲーション']")).toContainText("STORIES");
  await expect(page.locator("nav[aria-label='言語切り替え']")).toBeVisible();
});

test("fallback page emits content-identity alternates only (source excluded from request-locale)", async ({ page }) => {
  await page.goto("/zh/news/2026/S1-synth-2026-08-08-002/");
  // source (ja) only in alternates; zh must NOT appear; x-default → source detail
  await expect(page.locator('link[rel="alternate"][hreflang="zh"]')).toHaveCount(0);
  await expect(page.locator('link[rel="alternate"][hreflang="ja"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-002/",
  );
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-002/",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
});

test("real translation page emits full content-identity hreflang set", async ({ page }) => {
  await page.goto("/zh/news/2026/S1-synth-2026-08-08-001/");
  for (const lang of ["ja", "zh", "en"]) {
    await expect(page.locator(`link[rel="alternate"][hreflang="${lang}"]`)).toHaveAttribute(
      "href",
      `https://momoko.pro/${lang}/news/2026/S1-synth-2026-08-08-001/`,
    );
  }
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-001/",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
});

test("source-language detail page is self-canonical and NOT a fallback (no noindex)", async ({ page }) => {
  // 001 canonical is ja: /ja/...001/ must be the indexable source page.
  await page.goto("/ja/news/2026/S1-synth-2026-08-08-001/");
  await expect(page.locator('meta[name="robots"]')).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-001/",
  );
  await expect(page.locator("body")).not.toContainText("缺译");
  await expect(page.locator("body")).not.toContainText("未翻訳");

  // 002 canonical is ja (draft): still a source page, not fallback (no
  // missing-translation notice), but draft content is noindex,follow per content status.
  await page.goto("/ja/news/2026/S1-synth-2026-08-08-002/");
  await expect(page.locator("body")).not.toContainText("缺译");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-002/",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
});

test("archive lists only reviewed/current content (no draft/retracted)", async ({ page }) => {
  await page.goto("/zh/news/");
  const body = await page.locator("body").innerText();
  expect(body).toContain("夏フェス開催"); // reviewed 001
  expect(body).not.toContain("新曲発売決定"); // draft 002
  expect(body).not.toContain("撤回测试项"); // retracted 003
});
