import { resolveLocale, type NewsItem } from "./content.ts";
import { getActiveRetractionPaths } from "./content.ts";
import { resolveProfileLocale, type ProfileItem } from "./encyclopedia.ts";

export const SEARCH_LOCALES = ["ja", "zh", "en"] as const;
type Lang = (typeof SEARCH_LOCALES)[number];

export interface SearchRow {
  lang: Lang;
  slug: string;
  path: string;
  title: string | null;
  body: string | null;
  sourceId?: string;
  sourceItemId?: string;
  kind?: "news" | "encyclopedia";
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

/**
 * Deterministic profile search rows (Cycle S1). The current-reviewed gate is
 * internal: draft and actively retracted profiles never emit rows, regardless
 * of what the caller passes. Profile rows omit sourceId/sourceItemId entirely
 * (the serialized row never carries internal editorial ids).
 */
export function buildProfileSearchIndex(profiles: ProfileItem[]): SearchRow[] {
  const retracted = getActiveRetractionPaths();
  return profiles
    .filter((profile) => {
      const canonicalPath = `content/encyclopedia/${profile.slug}/content.${profile.canonical.lang}.md`;
      return (
        profile.canonical.reviewStatus === "reviewed" &&
        profile.canonical.body.length > 0 &&
        !retracted.has(canonicalPath)
      );
    })
    .flatMap((profile) =>
      SEARCH_LOCALES.map((lang): SearchRow => {
        const resolved = resolveProfileLocale(profile, lang);
        return {
          lang,
          slug: profile.slug,
          path: `/${lang}/encyclopedia/`,
          title: resolved.title,
          body: `${resolved.facts.tagline} ${Object.values(resolved.facts).join(" ")}`,
          kind: "encyclopedia",
        };
      }),
    )
    .sort((a, b) => `${a.lang}:${a.path}:${a.slug}`.localeCompare(`${b.lang}:${b.path}:${b.slug}`));
}
