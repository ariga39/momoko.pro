import { resolveLocale, type NewsItem } from "./content.ts";

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

/** Deterministic local search index (ADR-05 fallback): built from content, client-filtered. */
export function buildSearchIndex(items: NewsItem[]): SearchRow[] {
  return items
    .flatMap((item) =>
      SEARCH_LOCALES.map((lang): SearchRow => {
        const resolved = resolveLocale(item, lang);
        return {
          lang,
          slug: item.slug,
          path: `/${lang}/news/${item.slug}/`,
          title: item.canonical.title,
          body: resolved.body,
          sourceId: item.canonical.sourceId,
          sourceItemId: item.canonical.sourceItemId,
        };
      }),
    )
    .sort((a, b) => `${a.lang}:${a.slug}`.localeCompare(`${b.lang}:${b.slug}`));
}
