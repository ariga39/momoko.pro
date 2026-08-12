import { experimental_AstroContainer } from "astro/container";
import { describe, expect, it } from "vitest";

import { loadPublishedNews } from "../src/lib/content.ts";
import { loadPublishedProfiles } from "../src/lib/encyclopedia.ts";
import { buildProfileSearchIndex, buildSearchIndex } from "../src/lib/search.ts";

// Frozen trilingual kind labels: reuse the existing navigation vocabulary
// (nav.news / nav.encyclopedia message seam), no invented synonyms.
const KIND_LABEL: Record<string, { news: string; encyclopedia: string }> = {
  ja: { news: "ニュース", encyclopedia: "桃子百科" },
  zh: { news: "新闻", encyclopedia: "桃子百科" },
  en: { news: "News", encyclopedia: "Encyclopedia" },
};

// Profile facts frozen from the production content (task #50 inventory):
// 18 independent literals per locale (incl. tagline), all must be searchable.
const PROFILE_FACTS: Record<string, string[]> = {
  ja: [
    "周防桃子", "MOMOKO SUOU", "Fairy", "11歳", "11月6日", "B", "蠍座", "右",
    "140cm", "35kg", "73/53/74", "東京都", "渡部恵子", "765プロダクション",
    "かわいいシール集め", "演技や台詞の暗記", "ホットケーキ",
    "生意気？強がり？小さくて意地っぱりな妹系アイドル！",
  ],
  zh: [
    "周防桃子", "MOMOKO SUOU", "Fairy", "11岁", "11月6日", "B", "天蝎座", "右手",
    "140cm", "35kg", "73/53/74", "东京都", "渡部惠子", "765事务所",
    "收集可爱贴纸", "表演与记忆对白", "松饼",
    "傲气？逞强？娇小又倔强的妹妹系偶像！",
  ],
  en: [
    "Momoko Suou", "MOMOKO SUOU", "Fairy", "11", "November 6", "B", "Scorpio", "Right",
    "140cm", "35kg", "73/53/74", "Tokyo", "Keiko Watanabe", "765 PRO",
    "Collecting cute stickers", "Acting and memorizing lines", "Hotcakes",
    "Cheeky? Putting on a brave front? A petite, stubborn little-sister-style idol!",
  ],
};

// News literals (single production item, canonical title + localized bodies).
const NEWS_TITLE = "【ミリオンライブ】『究極Cuteな9周年直前ミリシタ生配信！』お知らせまとめ";
const NEWS_BODY: Record<string, string> = {
  ja: "公式ポータルは、ミリオンライブ！14th LIVE の詳細発表生配信を2026年6月13日19:00（予定）にYouTubeで実施すると案内した。",
  zh: "官方门户通知，将于2026年6月13日19:00（预定）在YouTube播出《ミリオンライブ！14th LIVE》详情公布直播。",
  en: "The official portal announced that a livestream revealing the details of MILLION LIVE! 14th LIVE will be held on YouTube at 19:00 (scheduled) on June 13, 2026.",
};

const LOCALES = ["ja", "zh", "en"] as const;

// Internal editorial representations that must never reach the search page.
// The news route slug S6-01_18661 is a legitimate content path, not a leak.
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
  it("each /<lang>/search/ renders exactly the current-locale news + profile rows with searchable localized title+body and no internal editorial metadata", async () => {
    // Sanity: production holds 1 published news item + 1 published profile, so
    // each locale page must surface exactly 2 result rows.
    const news = loadPublishedNews();
    const profiles = loadPublishedProfiles();
    expect(news).toHaveLength(1);
    expect(profiles).toHaveLength(1);
    expect(buildSearchIndex(news)).toHaveLength(3);
    expect(buildProfileSearchIndex(profiles)).toHaveLength(3);

    for (const lang of LOCALES) {
      const html = await renderSearchPage(lang);
      const items = [...html.matchAll(/<li data-search-item/g)];
      expect(items.length, `${lang} must show exactly 2 results`).toBe(2);

      // Both links carry the requested locale, and the two rows are exactly the
      // news path + the encyclopedia profile path.
      const newsHref = `/${lang}/news/2026/S6-01_18661/`;
      const profileHref = `/${lang}/encyclopedia/`;
      expect(html, `${lang} must render the news row`).toContain(`href="${newsHref}"`);
      expect(html, `${lang} must render the encyclopedia profile row`).toContain(`href="${profileHref}"`);
      const linkLangs = [...html.matchAll(/class="search-result" href="[^"]+" lang="([^"]+)"/g)].map((m) => m[1]);
      expect(linkLangs, `${lang} both result links must be the requested locale`).toEqual([lang, lang]);

      // News row: exact local title + localized body are both searchable.
      const newsPayload = [...html.matchAll(/data-search-text="([^"]*)"[^>]*>[^<]*<a class="search-result" href="[^"]*\/news\//g)].map((m) => m[1]);
      expect(newsPayload, `${lang} news row must exist`).toHaveLength(1);
      expect(newsPayload[0]!, `${lang} news search payload must include title`).toContain(NEWS_TITLE);
      expect(newsPayload[0]!, `${lang} news search payload must include localized body`).toContain(NEWS_BODY[lang]!);

      // Profile row: payload is exactly localized title + tagline + 18 facts.
      const profilePayload = [...html.matchAll(/data-search-text="([^"]*)"[^>]*>[^<]*<a class="search-result" href="[^"]*\/encyclopedia\//g)].map((m) => m[1]);
      expect(profilePayload, `${lang} profile row must exist`).toHaveLength(1);
      const profileText = profilePayload[0]!;
      for (const literal of PROFILE_FACTS[lang]!) {
        expect(profileText, `${lang} profile search payload must include ${literal}`).toContain(literal);
      }
      // Payload must not carry the kind label or any internal id.
      expect(profileText, `${lang} profile payload must not include kind label`).not.toContain(KIND_LABEL[lang]!.news);
      expect(profileText, `${lang} profile payload must not include kind label`).not.toContain(KIND_LABEL[lang]!.encyclopedia);
      expect(profileText).not.toMatch(/S7|sourceId|sourceItemId|source_id|source_item_id|@tsundere|T1|review_status|reviewed_by/);

      // The other two locales' profile content must NOT appear (ja/zh share the
      // title 周防桃子, so disambiguate by their distinct taglines).
      for (const other of LOCALES) {
        if (other === lang) continue;
        const otherTagline = PROFILE_FACTS[other]![17]!;
        expect(html, `${lang} page must not render ${other} profile tagline`).not.toContain(otherTagline);
      }

      // Kind labels are rendered, localized, via the navigation vocabulary.
      expect(html, `${lang} must render the localized News label`).toContain(KIND_LABEL[lang]!.news);
      expect(html, `${lang} must render the localized Encyclopedia label`).toContain(KIND_LABEL[lang]!.encyclopedia);

      // No internal editorial metadata anywhere in the server HTML.
      for (const token of FORBIDDEN_ANYWHERE) {
        expect(html, `${lang} search page must not leak ${token}`).not.toContain(token);
      }
      // The source id must not be rendered as a visible label or sr-only text.
      expect(html, `${lang} must not render a source-id label`).not.toMatch(/S6\s*[·—:-]/);
      expect(html, `${lang} must not render sr-only source-id`).not.toContain(">S6-01_18661<");
      expect(html, `${lang} must not render any sr-only internal id`).not.toMatch(/<span class="sr-only">[^<]*source[^<]*</);
      expect(html, `${lang} must not render the DEMO notice`).not.toContain("demo-notice");
    }
  });
});
