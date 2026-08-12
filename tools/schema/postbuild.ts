// Build-time artifact generation: manifest.json + search.json into dist/.
// Determinism: generated_at derives from the latest published_at in content
// (never the build clock), so two builds of the same input are byte-identical,
// verified by tools/schema/determinism.mjs.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  isRealTranslation,
  isRetracted,
  isCurrentReviewed,
  loadPublishedNews,
  type NewsItem,
} from "../../src/lib/content.ts";
import { loadPublishedProfiles } from "../../src/lib/encyclopedia.ts";
import { buildProfileSearchIndex, buildSearchIndex } from "../../src/lib/search.ts";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIST = path.resolve(
  REPO_ROOT,
  process.env.MOMOKO_BUILD_OUT_DIR ?? (process.env.PUBLIC_BUILD === "1" ? "dist-public" : "dist"),
);

const LOCALES = ["ja", "zh", "en"] as const;
type Lang = (typeof LOCALES)[number];

export function buildManifest(items: NewsItem[]) {
  const entries = items
    .filter(isCurrentReviewed)
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
        path: `content/news/${item.slug}/content.${c.lang}.md`,
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
  const items = loadPublishedNews();
  const published = items.map((it) => it.canonical.publishedAt).filter(Boolean).sort();
  const generatedAt = published.length
    ? published[published.length - 1]
    : "2000-01-01T00:00:00Z";
  const manifest = {
    manifest_version: "1",
    generated_at: generatedAt,
    entries: buildManifest(items).entries,
  };
  const searchIndex = [
    ...buildSearchIndex(loadPublishedNews()),
    ...buildProfileSearchIndex(loadPublishedProfiles()),
  ].sort((a, b) => `${a.lang}:${a.path}:${a.slug}`.localeCompare(`${b.lang}:${b.path}:${b.slug}`));

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
