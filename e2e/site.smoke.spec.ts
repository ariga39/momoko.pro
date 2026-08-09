import { expect, test } from "@playwright/test";

test("home is a static language selector with x-default + all hreflang alternates", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(/momoko\.pro/);
  await expect(page.locator('link[rel="alternate"][hreflang="zh"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/zh/",
  );
  await expect(page.locator('link[rel="alternate"][hreflang="ja"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja/",
  );
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/en/",
  );
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/",
  );
});

test("locale page lists the synthetic news item with hreflang alternates", async ({ page }) => {
  await page.goto("/zh/");
  await expect(page.locator("h1")).toHaveText(/中文/);
  await expect(page.locator("main a").first()).toHaveAttribute("lang", "zh");
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
  await page.goto("/search");
  const input = page.locator("#q");
  const results = page.locator("#results li");
  await input.fill("合成");
  await expect(results).toHaveCount(6);
  await expect(results.first()).toContainText("S1-synth-2026-08-08-001");
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

test("unknown route returns the 404 page with navigation", async ({ page }) => {
  await page.goto("/definitely-not-a-page/");
  await expect(page.locator("h1")).toHaveText("404");
  await expect(page.locator("nav[aria-label='回到首页'] a[href='/zh/']")).toBeVisible();
});

test("navigation is keyboard-accessible: skip link + focusable nav links", async ({ page }) => {
  await page.goto("/zh/");
  await expect(page.locator("a.skip-link")).toHaveAttribute("href", "#main");
  const nav = page.locator("nav[aria-label='主导航']");
  await expect(nav).toBeVisible();
  await nav.locator("a").first().focus();
  await expect(nav.locator("a").first()).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(nav.locator("a").nth(1)).toBeFocused();
});

test("language switcher navigates between locales", async ({ page }) => {
  await page.goto("/zh/");
  await page.locator("nav[aria-label='语言切换 / Language switcher'] a[href='/ja/']").click();
  await expect(page).toHaveURL(/\/ja\//);
  await expect(page.locator("h1")).toContainText("日本語");
});

test("UI chrome renders in each page locale (Paraglide pinned to route)", async ({ page }) => {
  await page.goto("/en/about/");
  await expect(page.locator("h1")).toHaveText("About momoko.pro");
  await expect(page).toHaveTitle(/About momoko\.pro/);
  await expect(page.locator("nav[aria-label='Main navigation']")).toContainText("News");
  await expect(page.locator("nav[aria-label='Main navigation']")).toContainText("Source Policy");
  await expect(page.locator("nav[aria-label='Language switcher']")).toBeVisible();
  await expect(page.locator("body")).toContainText("unofficial fan site");

  await page.goto("/zh/about/");
  await expect(page.locator("h1")).toHaveText("关于 momoko.pro");
  await expect(page.locator("nav[aria-label='主导航']")).toContainText("新闻");
  await expect(page.locator("nav[aria-label='语言切换 / Language switcher']")).toBeVisible();

  await page.goto("/ja/about/");
  await expect(page.locator("h1")).toHaveText("momoko.pro について");
  await expect(page.locator("nav[aria-label='メインナビゲーション']")).toContainText("ニュース");
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

  // 002 canonical is ja (draft): still a source page, not fallback (no 缺译 notice),
  // but draft content is noindex,follow per content status.
  await page.goto("/ja/news/2026/S1-synth-2026-08-08-002/");
  await expect(page.locator("body")).not.toContainText("缺译");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-002/",
  );
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex,follow");
});
