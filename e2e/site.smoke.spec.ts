import { expect, test } from "@playwright/test";

test("home is a static language selector with x-default + all hreflang alternates", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("h1")).toHaveText(/momoko\.pro/);
  await expect(page.locator('link[rel="alternate"][hreflang="zh"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/zh",
  );
  await expect(page.locator('link[rel="alternate"][hreflang="ja"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/ja",
  );
  await expect(page.locator('link[rel="alternate"][hreflang="en"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/en",
  );
  await expect(page.locator('link[rel="alternate"][hreflang="x-default"]')).toHaveAttribute(
    "href",
    "https://momoko.pro/",
  );
});

test("locale page lists the synthetic news item with hreflang alternates", async ({ page }) => {
  await page.goto("/zh");
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

  await page.goto("/zh/news/2026/S1-synth-2026-08-08-002/");
  await expect(page.locator("article")).toContainText("合成フィクスチャ本文");
  await expect(page.locator("body")).toContainText("缺译，回退源语言");
});

test("search page filters the deterministic local index client-side", async ({ page }) => {
  await page.goto("/search");
  const input = page.locator("#q");
  const results = page.locator("#results li");
  await input.fill("合成");
  await expect(results).toHaveCount(6);
  await expect(results.first()).toContainText("S1-synth-2026-08-08-001");
});
