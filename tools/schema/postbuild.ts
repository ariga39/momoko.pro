// Build-time artifact generation (B 拥有): manifest.json + search.json → dist。
// 确定性：generated_at 取内容中最晚 published_at（不读构建时钟），
// 同输入两次构建产物逐字节一致由 tools/schema/determinism.mjs 验证。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  isRealTranslation,
  isRetracted,
  loadNews,
  loadPublishedNews,
  type NewsItem,
} from "../../src/lib/content.ts";
import { buildSearchIndex } from "../../src/lib/search.ts";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIST = path.join(REPO_ROOT, "dist");

const LOCALES = ["ja", "zh", "en"] as const;
type Lang = (typeof LOCALES)[number];

export function buildManifest(items: NewsItem[]) {
  const entries = items
    .map((item) => {
      const c = item.canonical;
      const published = c.reviewStatus === "reviewed" && !isRetracted(item);
      const locales: Record<
        Lang,
        { status: string; hash: string | null; reviewed_by: string | null; stale_at: string | null }
      > = {} as Record<Lang, never>;
      for (const lang of LOCALES) {
        const loc = item.locales[lang];
        locales[lang] = {
          // A reviewed/current canonical source is published for its source
          // locale; a non-source locale requires a real current translation.
          status: published && (lang === c.lang || isRealTranslation(item, lang))
            ? "published"
            : loc?.meta.reviewStatus ?? c.reviewStatus,
          hash: loc?.meta.contentHash ?? c.contentHash,
          reviewed_by: loc?.meta.reviewedBy ?? (lang === c.lang ? c.reviewedBy ?? null : null),
          stale_at: null,
        };
      }
      return {
        path: `content/news/${item.slug}/index.md`,
        kind: c.kind,
        source_id: c.sourceId,
        source_item_id: c.sourceItemId,
        content_hash: c.contentHash,
        review_status: published ? "published" : c.reviewStatus,
        locales,
      };
    })
    .sort((a, b) =>
      `${a.source_id}:${a.source_item_id}`.localeCompare(`${b.source_id}:${b.source_item_id}`),
    );
  return { entries };
}

async function main() {
  const items = loadNews();
  const published = items.map((it) => it.canonical.publishedAt).filter(Boolean).sort();
  const generatedAt = published.length
    ? published[published.length - 1]
    : "2000-01-01T00:00:00Z";
  const manifest = {
    manifest_version: "1",
    generated_at: generatedAt,
    entries: buildManifest(items).entries,
  };
  const searchIndex = buildSearchIndex(loadPublishedNews());

  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(
    path.join(DIST, "manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  fs.writeFileSync(
    path.join(DIST, "search.json"),
    JSON.stringify(searchIndex, null, 2) + "\n",
  );
  console.log(`postbuild: manifest(${manifest.entries.length} entries) + search.json written`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
