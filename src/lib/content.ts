import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

/** Canonical index.md (content.schema.json): the source-language facts. */
export interface ContentMeta {
  schemaVersion: string;
  kind: string;
  sourceId: string;
  sourceItemId: string;
  publishedAt: string;
  contentHash: string;
  riskTier: string;
  aiGenerated?: boolean;
  modelVersion?: string | null;
  lang: "ja" | "zh" | "en";
  title: string;
  sourceUrl: string;
  originalTitle?: string | null;
  reviewStatus: "draft" | "reviewed" | "stale" | "retracted";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

/** content.<lang>.md (locale.schema.json): translation body + hash linkage. */
export interface LocaleMeta {
  schemaVersion: string;
  contentPath: string;
  lang: "ja" | "zh" | "en";
  sourceContentHash: string;
  contentHash: string;
  reviewStatus: "draft" | "reviewed" | "stale" | "retracted";
  reviewedBy?: string | null;
  reviewedAt?: string | null;
}

export interface LocaleFile {
  lang: "ja" | "zh" | "en";
  meta: LocaleMeta;
  body: string;
}

export interface NewsItem {
  /** content/news/2026/<source>-<itemid> */
  slug: string;
  canonical: ContentMeta;
  canonicalBody: string;
  /** translation files, keyed by lang (absent = 缺译) */
  locales: Partial<Record<"ja" | "zh" | "en", LocaleFile>>;
}

const LOCALE_LANGS = ["ja", "zh", "en"] as const;
type LocaleLang = (typeof LOCALE_LANGS)[number];

function parseCanonical(filePath: string): { meta: ContentMeta; body: string } {
  const { data, content } = matter(fs.readFileSync(filePath, "utf-8"));
  return { meta: normalizeContentMeta(data as Record<string, unknown>), body: content.trim() };
}

/** Map frontmatter snake_case keys to the camelCase ContentMeta shape. */
function normalizeContentMeta(d: Record<string, unknown>): ContentMeta {
  const meta: ContentMeta = {
    schemaVersion: String(d.schema_version ?? ""),
    kind: String(d.kind ?? ""),
    sourceId: String(d.source_id ?? ""),
    sourceItemId: String(d.source_item_id ?? ""),
    publishedAt: String(d.published_at ?? ""),
    contentHash: String(d.content_hash ?? ""),
    riskTier: String(d.risk_tier ?? ""),
    modelVersion: (d.model_version as string | null | undefined) ?? null,
    lang: (d.lang as ContentMeta["lang"]) ?? "ja",
    title: String(d.title ?? ""),
    sourceUrl: String(d.source_url ?? ""),
    originalTitle: (d.original_title as string | null | undefined) ?? null,
    reviewStatus: d.review_status as ContentMeta["reviewStatus"],
    reviewedBy: (d.reviewed_by as string | null | undefined) ?? null,
    reviewedAt: (d.reviewed_at as string | null | undefined) ?? null,
  };
  if (typeof d.ai_generated === "boolean") meta.aiGenerated = d.ai_generated;
  return meta;
}

function parseLocale(filePath: string): LocaleFile {
  const { data, content } = matter(fs.readFileSync(filePath, "utf-8"));
  const lang = path.basename(filePath).match(/^content\.(ja|zh|en)\.md$/)?.[1];
  if (!lang) throw new Error(`cannot infer lang from ${filePath}`);
  const d = data as Record<string, unknown>;
  return {
    lang: lang as LocaleLang,
    meta: {
      schemaVersion: String(d.schema_version ?? ""),
      contentPath: String(d.content_path ?? ""),
      lang: lang as LocaleLang,
      sourceContentHash: String(d.source_content_hash ?? ""),
      contentHash: String(d.content_hash ?? ""),
      reviewStatus: d.review_status as LocaleMeta["reviewStatus"],
      reviewedBy: (d.reviewed_by as string | null | undefined) ?? null,
      reviewedAt: (d.reviewed_at as string | null | undefined) ?? null,
    },
    body: content.trim(),
  };
}

function loadNewsItem(dir: string): NewsItem {
  const { meta, body } = parseCanonical(path.join(dir, "index.md"));
  const locales: NewsItem["locales"] = {};
  for (const lang of LOCALE_LANGS) {
    const file = path.join(dir, `content.${lang}.md`);
    if (fs.existsSync(file)) locales[lang] = parseLocale(file);
  }
  const rel = path.relative(path.join(REPO_ROOT, "content", "news"), dir);
  return {
    slug: rel,
    canonical: meta,
    canonicalBody: body,
    locales,
  };
}

/** Scan content/news/** and load every canonical item. */
export function loadNews(): NewsItem[] {
  const newsRoot = path.join(REPO_ROOT, "content", "news");
  const out: NewsItem[] = [];
  if (!fs.existsSync(newsRoot)) return out;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile() && entry.name === "index.md") {
        out.push(loadNewsItem(dir));
      }
    }
  };
  walk(newsRoot);
  return out;
}

/**
 * Resolve a display locale: exact translation, else fall back to the source
 * language (index.md). `hasTranslation` distinguishes fallback rendering.
 */
export function resolveLocale(
  item: NewsItem,
  lang: LocaleLang,
): { body: string; translated: boolean } {
  const loc = item.locales[lang];
  if (loc) return { body: loc.body, translated: true };
  return { body: item.canonicalBody, translated: false };
}

/** True when an exact translation exists for this lang. */
export function hasTranslation(item: NewsItem, lang: LocaleLang): boolean {
  return Boolean(item.locales[lang]);
}
