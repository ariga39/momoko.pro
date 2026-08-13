import { expect, test, type Page } from "@playwright/test";

// Final real-content E2E (task #52 contract): production real content, not the
// synthetic fixture. Covers the real encyclopedia and search visible paths for
// ja/zh/en and freezes the client-filter result-count status through the
// dedicated search.resultCountOne / search.resultCountOther message seam.
//
// True-red seam: the search page's client filter hardcodes `\`${visible}
// results\`` in English, and the server status reuses the noun visual.results.
// The frozen contract is a dedicated one/other count seam:
//   ja: 1件 / 2件;  zh: 1 条结果 / 2 条结果;  en: 1 result / 2 results
// Today ja/zh render the wrong English text and the singular/plural forms are
// absent, so the assertion fails — a genuine code defect.

// Frozen literals from the task #52 final-E2E contract (msg e772c902).
const LOCALES = ["ja", "zh", "en"] as const;
type Locale = (typeof LOCALES)[number];

const RESULT_COUNT: Record<Locale, { one: string; other: string }> = {
  ja: { one: "1件", other: "2件" },
  zh: { one: "1 条结果", other: "2 条结果" },
  en: { one: "1 result", other: "2 results" },
};

const PROFILE_TITLE: Record<Locale, string> = {
  ja: "周防桃子",
  zh: "周防桃子",
  en: "Momoko Suou",
};
const PROFILE_CV: Record<Locale, string> = {
  ja: "渡部恵子",
  zh: "渡部惠子",
  en: "Keiko Watanabe",
};
const PROFILE_BIRTHDAY: Record<Locale, string> = {
  ja: "11月6日",
  zh: "11月6日",
  en: "November 6",
};
const PROFILE_TAGLINE: Record<Locale, string> = {
  ja: "生意気？強がり？小さくて意地っぱりな妹系アイドル！",
  zh: "傲气？逞强？娇小又倔强的妹妹系偶像！",
  en: "Cheeky? Putting on a brave front? A petite, stubborn little-sister-style idol!",
};
const KIND_NEWS: Record<Locale, string> = {
  ja: "ニュース",
  zh: "新闻",
  en: "News",
};
const KIND_ENCYCLOPEDIA: Record<Locale, string> = {
  ja: "桃子百科",
  zh: "桃子百科",
  en: "Encyclopedia",
};

// Internal editorial representations that must never reach the visible page.
// The news route slug S6-01_18661 is a legitimate content path, not a leak.
const FORBIDDEN = ["DEMO", "S7", "sourceId", "sourceItemId", "@tsundere", "T1", "review_status"];

async function expectNoInternalLeaks(page: Page): Promise<void> {
  const body = page.locator("body");
  for (const token of FORBIDDEN) {
    await expect(body, `must not leak ${token}`).not.toContainText(token);
  }
}

test("real production encyclopedia and search pages are locale-aware with a localized result-count status", async ({ page }) => {
  for (const locale of LOCALES) {
    // --- Real encyclopedia page ---
    await page.goto(`/${locale}/encyclopedia/`);
    await expect(page.locator(".card-title")).toHaveText(PROFILE_TITLE[locale]);
    await expect(page.locator(".card-body")).toHaveText(PROFILE_TAGLINE[locale]);
    await expect(page.locator("body")).toContainText(PROFILE_CV[locale]);
    await expect(page.locator("body")).toContainText(PROFILE_BIRTHDAY[locale]);
    await expect(page.locator("body")).toContainText(KIND_ENCYCLOPEDIA[locale]);
    await expectNoInternalLeaks(page);

    // --- Real search page: exactly the current-locale rows ---
    await page.goto(`/${locale}/search/`);
    await expect(page.locator("#results li[data-search-item]")).toHaveCount(2);
    const profileLink = page.locator(`a.search-result[href="/${locale}/encyclopedia/"]`);
    const newsLink = page.locator(`a.search-result[href^="/${locale}/news/"]`);
    await expect(profileLink).toHaveCount(1);
    await expect(newsLink).toHaveCount(1);
    await expect(profileLink).toContainText(PROFILE_TITLE[locale]);
    await expect(profileLink).toContainText(PROFILE_TAGLINE[locale]);
    await expect(profileLink).toContainText(KIND_ENCYCLOPEDIA[locale]);
    await expect(newsLink).toContainText(KIND_NEWS[locale]);
    await expectNoInternalLeaks(page);

    // --- Result-count status: initial 2-item, filtered 1-item, cleared 2-item ---
    await expect(page.locator("#search-status")).toHaveText(RESULT_COUNT[locale].other);

    const input = page.locator("#q");
    await input.fill(PROFILE_CV[locale]);
    // Only the profile row remains visible after filtering on a local fact.
    await expect(page.locator("#results li[data-search-item]:visible")).toHaveCount(1);
    await expect(page.locator("#results li[data-search-item]:visible")).toContainText(PROFILE_TITLE[locale]);
    await expect(page.locator("#search-status")).toHaveText(RESULT_COUNT[locale].one);

    // Clearing restores the full current-locale list.
    await input.fill("");
    await expect(page.locator("#results li[data-search-item]:visible")).toHaveCount(2);
    await expect(page.locator("#search-status")).toHaveText(RESULT_COUNT[locale].other);
  }
});
