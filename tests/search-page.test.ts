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

// 18 profile facts per locale in the builder's frozen field order (ProfileFacts
// interface order: name, nameRoman, cv, affiliation, type, age, birthday,
// bloodType, constellation, handedness, height, weight, threeSizes, birthplace,
// hobby, specialty, likes, tagline), taken from the production content.
const PROFILE_FACTS: Record<string, string[]> = {
  ja: [
    "周防桃子", "MOMOKO SUOU", "渡部恵子", "765プロダクション", "Fairy", "11歳",
    "11月6日", "B", "蠍座", "右", "140cm", "35kg", "73/53/74", "東京都",
    "かわいいシール集め", "演技や台詞の暗記", "ホットケーキ",
    "生意気？強がり？小さくて意地っぱりな妹系アイドル！",
  ],
  zh: [
    "周防桃子", "MOMOKO SUOU", "渡部惠子", "765事务所", "Fairy", "11岁",
    "11月6日", "B", "天蝎座", "右手", "140cm", "35kg", "73/53/74", "东京都",
    "收集可爱贴纸", "表演与记忆对白", "松饼",
    "傲气？逞强？娇小又倔强的妹妹系偶像！",
  ],
  en: [
    "Momoko Suou", "MOMOKO SUOU", "Keiko Watanabe", "765 PRO", "Fairy", "11",
    "November 6", "B", "Scorpio", "Right", "140cm", "35kg", "73/53/74", "Tokyo",
    "Collecting cute stickers", "Acting and memorizing lines", "Hotcakes",
    "Cheeky? Putting on a brave front? A petite, stubborn little-sister-style idol!",
  ],
};

const PROFILE_TITLE: Record<string, string> = {
  ja: "周防桃子",
  zh: "周防桃子",
  en: "Momoko Suou",
};

// News literals (single production item): the search row title is the canonical
// (ja) title for every locale; the body is the localized body.
const NEWS_TITLE = "【ミリオンライブ】『究極Cuteな9周年直前ミリシタ生配信！』お知らせまとめ";
const NEWS_BODY: Record<string, string> = {
  ja: "公式ポータルは、ミリオンライブ！14th LIVE の詳細発表生配信を2026年6月13日19:00（予定）にYouTubeで実施すると案内した。",
  zh: "官方门户通知，将于2026年6月13日19:00（预定）在YouTube播出《ミリオンライブ！14th LIVE》详情公布直播。",
  en: "The official portal announced that a livestream revealing the details of MILLION LIVE! 14th LIVE will be held on YouTube at 19:00 (scheduled) on June 13, 2026.",
};

const LOCALES = ["ja", "zh", "en"] as const;

// Tokens that can never legitimately appear in a search-page href: whole-page
// exclusion (the news route slug S6-01_18661 is a legitimate content path).
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

/**
 * Frozen exact payload strings. The page renders data-search-text as
 * `${row.title} ${row.body}`; the profile body is the builder's frozen order
 * (tagline + the 18 facts joined, keeping the current repeated-tagline
 * semantics). These literals are authored from the content, never computed by
 * the implementation.
 */
function newsPayload(lang: string): string {
  return `${NEWS_TITLE} ${NEWS_BODY[lang]!}`;
}

function profilePayload(lang: string): string {
  const tagline = PROFILE_FACTS[lang]![17]!;
  return `${PROFILE_TITLE[lang]!} ${tagline} ${PROFILE_FACTS[lang]!.join(" ")}`;
}

interface Row {
  searchText: string;
  href: string;
  eyebrow: string;
  srOnly: string[];
}

function parseRows(html: string): Row[] {
  const rows: Row[] = [];
  const liRe = /<li data-search-item\b[^>]*>([\s\S]*?)<\/li>/g;
  for (const liMatch of html.matchAll(liRe)) {
    const fullTag = liMatch[0]!.slice(0, liMatch[0]!.indexOf(">") + 1);
    const block = liMatch[1]!;
    const searchText = fullTag.match(/data-search-text="([^"]*)"/)?.[1] ?? "";
    const href = block.match(/<a class="search-result" href="([^"]+)"/)?.[1] ?? "";
    const eyebrow = block.match(/<span class="card-eyebrow"[^>]*>([^<]*)</)?.[1] ?? "";
    const srOnly = [...block.matchAll(/<span class="sr-only"[^>]*>([^<]*)</g)].map((m) => m[1]!);
    rows.push({ searchText, href, eyebrow, srOnly });
  }
  return rows;
}

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
  it("each /<lang>/search/ renders exactly the current-locale news + profile rows with exact title+body payloads and no visible internal editorial metadata", async () => {
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
      const rows = parseRows(html);
      expect(rows.length, `${lang} must show exactly 2 result rows`).toBe(2);

      // Exactly one news row and one profile row, both current-locale.
      const newsRows = rows.filter((r) => r.href.startsWith(`/${lang}/news/`));
      const profileRows = rows.filter((r) => r.href === `/${lang}/encyclopedia/`);
      expect(newsRows, `${lang} must render exactly one news row`).toHaveLength(1);
      expect(profileRows, `${lang} must render exactly one profile row`).toHaveLength(1);

      // The news href legitimately carries the S6 slug (content path); the
      // payload must be EXACTLY the frozen localized title + body.
      expect(newsRows[0]!.href).toBe(`/${lang}/news/2026/S6-01_18661/`);
      expect(newsRows[0]!.searchText, `${lang} news payload must equal title+body`).toBe(newsPayload(lang));
      expect(newsRows[0]!.eyebrow, `${lang} news kind label`).toBe(KIND_LABEL[lang]!.news);
      // No visible/sr-only internal id on the news row.
      expect(newsRows[0]!.srOnly, `${lang} news row must not carry sr-only ids`).toEqual([]);

      // Profile row: exact frozen payload (localized title + tagline + 18 facts).
      const profile = profileRows[0]!;
      expect(profile.searchText, `${lang} profile payload must equal title+tagline+18 facts`).toBe(profilePayload(lang));
      expect(profile.eyebrow, `${lang} profile kind label`).toBe(KIND_LABEL[lang]!.encyclopedia);
      expect(profile.srOnly, `${lang} profile row must not carry sr-only ids`).toEqual([]);

      // Neither payload may carry the kind label, lang, or internal ids.
      for (const row of rows) {
        expect(row.searchText, `${lang} payload must not carry kind label`).not.toContain(KIND_LABEL[lang]!.news);
        expect(row.searchText, `${lang} payload must not carry kind label`).not.toContain(KIND_LABEL[lang]!.encyclopedia);
        expect(row.searchText, `${lang} payload must not carry the lang`).not.toMatch(new RegExp(`(^|\\s)${lang}(\\s|$)`));
        expect(row.searchText).not.toMatch(/S7|sourceId|sourceItemId|source_id|source_item_id|@tsundere|T1|review_status|reviewed_by/);
      }

      // Whole-page exclusion of tokens that cannot appear in legitimate hrefs.
      for (const token of FORBIDDEN_ANYWHERE) {
        expect(html, `${lang} search page must not leak ${token}`).not.toContain(token);
      }
      expect(html, `${lang} must not render the DEMO notice`).not.toContain("demo-notice");
    }
  });
});
