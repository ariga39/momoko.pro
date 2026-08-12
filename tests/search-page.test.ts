import { experimental_AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import { loadPublishedNews } from "../src/lib/content.ts";
import { loadPublishedProfiles } from "../src/lib/encyclopedia.ts";
import { buildProfileSearchIndex, buildSearchIndex } from "../src/lib/search.ts";

// Frozen trilingual user labels for the result-type column (S2 contract).
const NEWS_LABEL: Record<string, string> = {
  ja: "ニュース",
  zh: "新闻",
  en: "News",
};
const ENCYCLOPEDIA_LABEL: Record<string, string> = {
  ja: "桃子百科",
  zh: "桃子百科",
  en: "Encyclopedia",
};

// Profile exact local title/tagline/path from the frozen production content.
const PROFILE_EXPECT: Record<string, { title: string; tagline: string; path: string }> = {
  ja: {
    title: "周防桃子",
    tagline: "生意気？強がり？小さくて意地っぱりな妹系アイドル！",
    path: "/ja/encyclopedia/",
  },
  zh: {
    title: "周防桃子",
    tagline: "傲气？逞强？娇小又倔强的妹妹系偶像！",
    path: "/zh/encyclopedia/",
  },
  en: {
    title: "Momoko Suou",
    tagline: "Cheeky? Putting on a brave front? A petite, stubborn little-sister-style idol!",
    path: "/en/encyclopedia/",
  },
};

const LOCALES = ["ja", "zh", "en"] as const;

// Internal editorial representations that must never appear anywhere in the
// search page's server HTML. These are distinct from the news route slug
// (which legitimately carries the content path).
const FORBIDDEN_ANYWHERE = [
  "DemoNotice",
  "DEMO",
  "S7",
  "sourceId",
  "sourceItemId",
  "source_id",
  "source_item_id",
  "@tsundere",
  "T1",
  "review_status",
  "reviewed_by",
];

async function renderSearchPage(lang: string): Promise<string> {
  delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
  delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
  delete process.env.PUBLIC_BUILD;
  delete process.env.MOMOKO_CONTENT_PACKAGE_PREVIEW;
  const container = await experimental_AstroContainer.create();
  const page = await import("../src/pages/[lang]/search/index.astro");
  return container.renderToString(page.default, {
    params: { lang },
    request: new Request(`http://localhost/${lang}/search/`),
  });
}

describe("locale-aware search page (Cycle S2)", () => {
  it("each /<lang>/search/ renders exactly the current-locale news + profile rows and never leaks internal editorial metadata", async () => {
    // Sanity: production holds 1 published news item and 1 published profile,
    // so each locale should surface exactly 2 result rows.
    const news = loadPublishedNews();
    const profiles = loadPublishedProfiles();
    expect(news).toHaveLength(1);
    expect(profiles).toHaveLength(1);
    expect(buildSearchIndex(news)).toHaveLength(3);
    expect(buildProfileSearchIndex(profiles)).toHaveLength(3);

    for (const lang of LOCALES) {
      const html = await renderSearchPage(lang);
      // Exactly two result rows per locale: one news, one encyclopedia profile.
      const resultItems = html.match(/<li data-search-item/g) ?? [];
      expect(resultItems.length, `${lang} must show exactly 2 results`).toBe(2);

      // Both result rows must be the current locale only — no duplicate rows
      // from the other two languages.
      const newsPath = `/${lang}/news/2026/S6-01_18661/`;
      expect(html, `${lang} must render its own news row`).toContain(newsPath);
      const profile = PROFILE_EXPECT[lang]!;
      expect(html, `${lang} must link the encyclopedia profile path`).toContain(`href="${profile.path}"`);

      // The encyclopedia profile row: exact local title and tagline.
      expect(html, `${lang} must render the profile title`).toContain(profile.title);
      expect(html, `${lang} must render the profile tagline`).toContain(profile.tagline);

      // Result-type column labels, localized (News / Encyclopedia).
      expect(html, `${lang} must render the localized News label`).toContain(NEWS_LABEL[lang]!);
      expect(html, `${lang} must render the localized Encyclopedia label`).toContain(ENCYCLOPEDIA_LABEL[lang]!);

      // No internal editorial metadata anywhere in the server HTML.
      for (const token of FORBIDDEN_ANYWHERE) {
        expect(html, `${lang} search page must not leak ${token}`).not.toContain(token);
      }

      // The internal source id (S6) must not be rendered as a visible label or
      // sr-only text, and must not appear inside the client filter payload.
      expect(html, `${lang} must not render a source-id label`).not.toMatch(/S6\s*[·—:-]/);
      expect(html, `${lang} must not render sr-only source-id`).not.toContain(">S6-01_18661<");
      for (const match of html.matchAll(/data-search-text="([^"]*)"/g)) {
        const payload = match[1]!;
        expect(payload, `${lang} search-text must not carry internal ids`).not.toMatch(/\bS6\b|\bS7\b|sourceId|sourceItemId|01_18661/);
      }
    }
  });
});
