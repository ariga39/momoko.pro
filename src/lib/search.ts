import type { NewsItem } from "./content.ts";

export const SEARCH_LOCALES = ["ja", "zh", "en"] as const;
type Lang = (typeof SEARCH_LOCALES)[number];

export interface SearchRow {
  lang: Lang;
  slug: string;
  path: string;
  title: string | null;
  body: string | null;
  sourceId: string;
  sourceItemId: string;
}

/** 确定性本地搜索索引（ADR-05 fallback）：由 content 全量生成、客户端过滤。 */
export function buildSearchIndex(items: NewsItem[]): SearchRow[] {
  return items
    .flatMap((item) =>
      SEARCH_LOCALES.map((lang): SearchRow => {
        const loc = item.locales[lang];
        return {
          lang,
          slug: item.slug,
          path: `/${lang}/news/${item.slug}/`,
          title: item.canonical.title,
          body: loc?.body ?? item.canonicalBody,
          sourceId: item.canonical.sourceId,
          sourceItemId: item.canonical.sourceItemId,
        };
      }),
    )
    .sort((a, b) => `${a.lang}:${a.slug}`.localeCompare(`${b.lang}:${b.slug}`));
}
