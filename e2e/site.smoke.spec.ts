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
