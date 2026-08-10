import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import { fileURLToPath } from "node:url";
import { validateFile } from "../../tools/schema/validate.ts";
import { embeddedPackage } from "./embedded-package.ts";
import { runtimeEnv } from "./runtime-config.ts";

const EMBEDDED_ROOT = "/__momoko_embedded_content_package__";

function resolveRepositoryRoot(): string {
  const explicit = runtimeEnv("MOMOKO_REPO_ROOT");
  if (explicit && path.isAbsolute(explicit)) return explicit;
  try {
    return path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
  } catch {
    // Cloudflare's module runtime does not provide a file URL for bundled
    // worker modules. Local Wrangler still exposes the project cwd; a real
    // deployment must supply content as an explicit package or remain empty.
    return typeof process.cwd === "function" ? process.cwd() : "/";
  }
}

export const REPO_ROOT = resolveRepositoryRoot();
const PACKAGE_ROOT_ENV = "MOMOKO_CONTENT_PACKAGE_ROOT";
const PACKAGE_MODE_ENV = "MOMOKO_CONTENT_PACKAGE_MODE";

export type ContentPackageMode = "test" | "dev";

export class ContentPackageError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "ContentPackageError";
    this.code = code;
  }
}

export interface ContentPackageManifest {
  package_version: "1";
  content_schema_version: "1";
  status: "empty" | "ready";
  visual_catalog?: "visual-catalog.json";
}

function embeddedFile(relativePath: string): string {
  const file = embeddedPackage.files[relativePath];
  if (file === undefined) throw new ContentPackageError("content_package_file_missing", "content package file is missing");
  return file;
}

export function readEmbeddedPackageFile(relativePath: string): string {
  if (!embeddedPackage.enabled) throw new ContentPackageError("content_package_not_embedded", "content package is not embedded");
  return embeddedFile(relativePath);
}

function embeddedHasFile(relativePath: string): boolean {
  return Object.prototype.hasOwnProperty.call(embeddedPackage.files, relativePath);
}

function assertEmbeddedBinding(): void {
  const raw = runtimeEnv(PACKAGE_ROOT_ENV);
  const mode = runtimeEnv(PACKAGE_MODE_ENV);
  if (runtimeEnv("PUBLIC_BUILD") === "1" && (raw !== undefined || mode !== undefined)) {
    throw new ContentPackageError("public_build_content_override_forbidden", "public build cannot use a content override");
  }
  if (embeddedPackage.explicit) {
    if (raw !== embeddedPackage.relativeRoot || mode !== embeddedPackage.mode) {
      throw new ContentPackageError("content_package_binding_mismatch", "content package binding does not match the build");
    }
  } else if (raw !== undefined || mode !== undefined) {
    throw new ContentPackageError("content_package_binding_mismatch", "content package override is not part of this build");
  }
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

/**
 * Resolve the package used by a build. An override is never implicit: it
 * requires an explicit test/dev mode and test packages must live below the
 * checked-in fixture root. Production builds therefore cannot inherit demo
 * content from an environment variable or a silent fallback.
 */
export function getContentRoot(): string {
  if (embeddedPackage.enabled) {
    assertEmbeddedBinding();
    return EMBEDDED_ROOT;
  }
  const repoRoot = resolveRepositoryRoot();
  const defaultContentRoot = path.join(repoRoot, "content");
  const testContentPackageBase = path.join(repoRoot, "tests", "fixtures", "content-package");
  const devContentPackageBase = path.join(repoRoot, "content-dev");
  const raw = runtimeEnv(PACKAGE_ROOT_ENV);
  const mode = runtimeEnv(PACKAGE_MODE_ENV) as ContentPackageMode | undefined;
  if (runtimeEnv("PUBLIC_BUILD") === "1" && (raw !== undefined || mode !== undefined)) {
    throw new ContentPackageError(
      "public_build_content_override_forbidden",
      "public build cannot use a content override",
    );
  }
  if (raw !== undefined) {
    if (!raw.trim()) {
      throw new ContentPackageError("content_package_root_empty", `${PACKAGE_ROOT_ENV} is empty`);
    }
    if (mode !== "test" && mode !== "dev") {
      throw new ContentPackageError(
        "content_package_mode_required",
        `${PACKAGE_MODE_ENV} must be explicitly set to test or dev when ${PACKAGE_ROOT_ENV} is set`,
      );
    }
    if (path.isAbsolute(raw)) {
      throw new ContentPackageError(
        "content_package_root_absolute",
        "content package root must be a relative repository path",
      );
    }
    const root = path.resolve(repoRoot, raw);
    const allowedRoot = mode === "test" ? testContentPackageBase : devContentPackageBase;
    if (!isInside(root, allowedRoot)) {
      throw new ContentPackageError(
        `${mode}_content_package_outside_root`,
        `${mode} content packages must stay inside the configured repository root`,
      );
    }
    return assertContentRoot(root);
  }
  if (runtimeEnv(PACKAGE_MODE_ENV) !== undefined) {
    throw new ContentPackageError(
      "content_package_mode_without_root",
      `${PACKAGE_MODE_ENV} requires an explicit ${PACKAGE_ROOT_ENV}`,
    );
  }
  return assertContentRoot(defaultContentRoot);
}

function assertContentRoot(root: string): string {
  if (!fs.existsSync(root)) {
    throw new ContentPackageError("content_package_missing", "content package directory is missing");
  }
  const stat = fs.lstatSync(root);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new ContentPackageError("content_package_root_invalid", "content package root must be a real directory");
  }
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ContentPackageError("content_package_symlink", "content package contains a symlink");
      }
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(root);
  return root;
}

function readPackageManifest(root: string): ContentPackageManifest {
  const manifestPath = path.join(root, "package.json");
  if (!fs.existsSync(manifestPath) || fs.lstatSync(manifestPath).isSymbolicLink()) {
    throw new ContentPackageError("content_package_manifest_missing", "content package package.json is missing or symlinked");
  }
  let manifest: unknown;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  } catch {
    throw new ContentPackageError("content_package_manifest_invalid", "content package package.json is not valid JSON");
  }
  const checked = validateFile("content-package.schema.json", manifest);
  if (!checked.valid) {
    throw new ContentPackageError("content_package_manifest_invalid", "content package manifest failed schema validation");
  }
  return manifest as ContentPackageManifest;
}

function readEmbeddedPackageManifest(): ContentPackageManifest {
  let manifest: unknown;
  try {
    manifest = JSON.parse(embeddedFile("package.json"));
  } catch {
    throw new ContentPackageError("content_package_manifest_invalid", "content package package.json is not valid JSON");
  }
  const checked = validateFile("content-package.schema.json", manifest);
  if (!checked.valid) {
    throw new ContentPackageError("content_package_manifest_invalid", "content package manifest failed schema validation");
  }
  return manifest as ContentPackageManifest;
}

function assertKnownPackageEntries(root: string, manifest: ContentPackageManifest): void {
  const allowed = new Set(["package.json", "news", "retractions"]);
  if (manifest.visual_catalog) {
    const mode = runtimeEnv(PACKAGE_MODE_ENV);
    if (
      runtimeEnv(PACKAGE_ROOT_ENV) === undefined ||
      (mode !== "test" && mode !== "dev")
    ) {
      throw new ContentPackageError(
        "visual_catalog_mode_required",
        "visual catalog is allowed only for an explicit test or dev content package",
      );
    }
    allowed.add(manifest.visual_catalog);
  }
  for (const entry of fs.readdirSync(root)) {
    if (!allowed.has(entry)) {
      throw new ContentPackageError("content_package_entry_unsupported", `unsupported content package entry: ${entry}`);
    }
  }
}

function packageManifest(root: string): ContentPackageManifest {
  const manifest = readPackageManifest(root);
  assertKnownPackageEntries(root, manifest);
  return manifest;
}

function embeddedPackageManifest(): ContentPackageManifest {
  const manifest = readEmbeddedPackageManifest();
  const topLevel = new Set<string>();
  for (const file of Object.keys(embeddedPackage.files)) {
    const [entry] = file.split("/");
    if (entry) topLevel.add(entry);
  }
  const allowed = new Set(["package.json", "news", "retractions"]);
  if (manifest.visual_catalog) {
    if (!embeddedPackage.explicit || (embeddedPackage.mode !== "test" && embeddedPackage.mode !== "dev")) {
      throw new ContentPackageError(
        "visual_catalog_mode_required",
        "visual catalog is allowed only for an explicit test or dev content package",
      );
    }
    allowed.add(manifest.visual_catalog);
  }
  for (const entry of topLevel) {
    if (!allowed.has(entry)) {
      throw new ContentPackageError("content_package_entry_unsupported", "unsupported content package entry");
    }
  }
  for (const file of Object.keys(embeddedPackage.files)) {
    if (file.startsWith("news/") && !/\/index\.md$|\/content\.(ja|zh|en)\.md$|\/editorial-history\.json$/.test(file)) {
      throw new ContentPackageError("content_package_entry_unsupported", "unsupported news entry");
    }
  }
  return manifest;
}

/** Read and validate a package manifest after enforcing its top-level boundary. */
export function readContentPackageManifest(): ContentPackageManifest {
  if (embeddedPackage.enabled) return embeddedPackageManifest();
  return packageManifest(getContentRoot());
}

/** content paths with an active retraction record（status=requested|active）。 */
function retractedPaths(): Set<string> {
  return loadRetractions();
}

function loadRetractions(contentRoot = getContentRoot()): Set<string> {
  if (embeddedPackage.enabled) return loadEmbeddedRetractions();
  const out = new Set<string>();
  const root = path.join(contentRoot, "retractions");
  if (!fs.existsSync(root)) return out;
  if (fs.lstatSync(root).isSymbolicLink() || !fs.statSync(root).isDirectory()) {
    throw new ContentPackageError("content_package_retractions_invalid", "retractions must be a real directory");
  }
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ContentPackageError("content_package_symlink", `symlink in retractions: ${entry.name}`);
      }
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith(".json")) {
        try {
          const rec = JSON.parse(fs.readFileSync(full, "utf-8")) as Record<string, unknown>;
          const checked = validateFile("retraction.schema.json", rec);
          if (!checked.valid) {
            throw new ContentPackageError(
              "content_package_retraction_invalid",
              checked.errors ?? `invalid retraction: ${path.relative(contentRoot, full)}`,
            );
          }
          if (
            typeof rec.content_path === "string" &&
            (rec.status === "requested" || rec.status === "active")
          ) {
            out.add(rec.content_path);
          }
        } catch (error) {
          if (error instanceof ContentPackageError) throw error;
          throw new ContentPackageError(
            "content_package_retraction_invalid",
            `invalid retraction file: ${path.relative(contentRoot, full)}`,
          );
        }
      } else if (entry.isFile()) {
        throw new ContentPackageError("content_package_entry_unsupported", `unsupported retraction entry: ${entry.name}`);
      }
    }
  };
  walk(root);
  return out;
}

function loadEmbeddedRetractions(): Set<string> {
  const out = new Set<string>();
  for (const [file, text] of Object.entries(embeddedPackage.files)) {
    if (!file.startsWith("retractions/")) continue;
    if (!file.endsWith(".json")) throw new ContentPackageError("content_package_entry_unsupported", "unsupported retraction entry");
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new ContentPackageError("content_package_retraction_invalid", "invalid retraction file");
    }
    const checked = validateFile("retraction.schema.json", rec);
    if (!checked.valid) throw new ContentPackageError("content_package_retraction_invalid", "invalid retraction file");
    if (typeof rec.content_path === "string" && (rec.status === "requested" || rec.status === "active")) {
      out.add(rec.content_path);
    }
  }
  return out;
}

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
  /** translation files, keyed by lang (absent = missing translation) */
  locales: Partial<Record<"ja" | "zh" | "en", LocaleFile>>;
}

const LOCALE_LANGS = ["ja", "zh", "en"] as const;
type LocaleLang = (typeof LOCALE_LANGS)[number];

function parseCanonicalText(filePath: string, text: string): { meta: ContentMeta; body: string } {
  const { data, content } = matter(text);
  const record = { ...(data as Record<string, unknown>), body: content.trim() };
  const checked = validateFile("content.schema.json", record);
  if (!checked.valid) {
    throw new ContentPackageError(
      "content_package_content_invalid",
      `${path.basename(filePath)} failed content schema validation: ${checked.errors ?? "invalid"}`,
    );
  }
  return { meta: normalizeContentMeta(record), body: content.trim() };
}

function parseCanonical(filePath: string): { meta: ContentMeta; body: string } {
  return parseCanonicalText(filePath, fs.readFileSync(filePath, "utf-8"));
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

function parseLocaleText(filePath: string, text: string): LocaleFile {
  const { data, content } = matter(text);
  const lang = path.basename(filePath).match(/^content\.(ja|zh|en)\.md$/)?.[1];
  if (!lang) throw new Error(`cannot infer lang from ${filePath}`);
  const d = data as Record<string, unknown>;
  const record = { ...d, body: content.trim() };
  const checked = validateFile("locale.schema.json", record);
  if (!checked.valid) {
    throw new ContentPackageError(
      "content_package_locale_invalid",
      `${path.basename(filePath)} failed locale schema validation: ${checked.errors ?? "invalid"}`,
    );
  }
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

function parseLocale(filePath: string): LocaleFile {
  return parseLocaleText(filePath, fs.readFileSync(filePath, "utf-8"));
}

function loadNewsItem(contentRoot: string, dir: string): NewsItem {
  const { meta, body } = parseCanonical(path.join(dir, "index.md"));
  const locales: NewsItem["locales"] = {};
  for (const lang of LOCALE_LANGS) {
    const file = path.join(dir, `content.${lang}.md`);
    if (fs.existsSync(file)) {
      if (fs.lstatSync(file).isSymbolicLink()) {
        throw new ContentPackageError("content_package_symlink", `symlinked locale file: ${path.basename(file)}`);
      }
      locales[lang] = parseLocale(file);
    }
  }
  const rel = path.relative(path.join(contentRoot, "news"), dir);
  return {
    slug: rel,
    canonical: meta,
    canonicalBody: body,
    locales,
  };
}

function loadEmbeddedNewsItem(dir: string): NewsItem {
  const canonicalPath = `${dir}/index.md`;
  const { meta, body } = parseCanonicalText(canonicalPath, embeddedFile(canonicalPath));
  const locales: NewsItem["locales"] = {};
  for (const lang of LOCALE_LANGS) {
    const file = `${dir}/content.${lang}.md`;
    if (embeddedHasFile(file)) locales[lang] = parseLocaleText(file, embeddedFile(file));
  }
  return { slug: dir.slice("news/".length), canonical: meta, canonicalBody: body, locales };
}

/** Scan content/news/** and load every canonical item. */
export function loadNews(): NewsItem[] {
  if (embeddedPackage.enabled) return loadEmbeddedNews();
  const contentRoot = getContentRoot();
  const manifest = packageManifest(contentRoot);
  // Validate every retraction record even for an empty package or before an
  // item happens to ask for its status. A malformed package must fail closed.
  loadRetractions(contentRoot);
  const newsRoot = path.join(contentRoot, "news");
  const out: NewsItem[] = [];
  if (!fs.existsSync(newsRoot)) {
    if (manifest.status === "ready") {
      throw new ContentPackageError("content_package_ready_without_news", "ready content package has no news directory");
    }
    return out;
  }
  if (fs.lstatSync(newsRoot).isSymbolicLink() || !fs.statSync(newsRoot).isDirectory()) {
    throw new ContentPackageError("content_package_news_invalid", "news must be a real directory");
  }
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new ContentPackageError("content_package_symlink", `symlink in content package: ${entry.name}`);
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        if (entry.name === "index.md") {
          out.push(loadNewsItem(contentRoot, dir));
        } else if (!/^content\.(ja|zh|en)\.md$/.test(entry.name) && entry.name !== "editorial-history.json") {
          throw new ContentPackageError("content_package_entry_unsupported", `unsupported news entry: ${entry.name}`);
        }
      }
    }
  };
  walk(newsRoot);
  if (manifest.status === "empty" && out.length > 0) {
    throw new ContentPackageError("content_package_empty_with_content", "empty content package contains canonical content");
  }
  if (manifest.status === "ready" && out.length === 0) {
    throw new ContentPackageError("content_package_ready_without_content", "ready content package contains no canonical content");
  }
  // Production builds are always public-safe. Draft/stale/retracted records
  // are available only to an explicit test/dev package override, while
  // PUBLIC_BUILD=1 also forces the same filter for that override.
  if (runtimeEnv("PUBLIC_BUILD") === "1" || runtimeEnv(PACKAGE_ROOT_ENV) === undefined) {
    return out.filter(isCurrentReviewed);
  }
  return out;
}

function loadEmbeddedNews(): NewsItem[] {
  const manifest = embeddedPackageManifest();
  loadEmbeddedRetractions();
  const dirs = new Set<string>();
  for (const file of Object.keys(embeddedPackage.files)) {
    if (file.startsWith("news/") && file.endsWith("/index.md")) {
      dirs.add(file.slice(0, -"/index.md".length));
    }
  }
  const out = [...dirs].sort().map((dir) => loadEmbeddedNewsItem(dir));
  if (manifest.status === "empty" && out.length > 0) {
    throw new ContentPackageError("content_package_empty_with_content", "empty content package contains canonical content");
  }
  if (manifest.status === "ready" && out.length === 0) {
    throw new ContentPackageError("content_package_ready_without_content", "ready content package contains no canonical content");
  }
  if (runtimeEnv("PUBLIC_BUILD") === "1" || runtimeEnv(PACKAGE_ROOT_ENV) === undefined) {
    return out.filter(isCurrentReviewed);
  }
  return out;
}

/**
 * A current item is reviewed at the latest source revision and has no active
 * retraction. Draft/stale/retracted records remain readable by the detail
 * route so they can render an explicit noindex/fallback response, but they
 * must never enter public archive/search/build indexes.
 */
export function isCurrentReviewed(item: NewsItem): boolean {
  return item.canonical.reviewStatus === "reviewed" && !isRetracted(item);
}

/** Items eligible for the public archive/search surface. */
export function loadPublishedNews(): NewsItem[] {
  return loadNews().filter(isCurrentReviewed);
}

/**
 * A locale file is a REAL translation only when（design §1.2）:
 *  - body is non-empty,
 *  - review_status === "reviewed",
 *  - source_content_hash === canonical content_hash (no drift),
 *  - and the item is not retracted.
 * Anything else is fail-closed → treated as missing (fallback to source).
 */
export function isRealTranslation(item: NewsItem, lang: LocaleLang): boolean {
  const loc = item.locales[lang];
  if (!loc) return false;
  if (!isCurrentReviewed(item)) return false;
  if (!loc.body || !loc.body.trim()) return false;
  if (loc.meta.reviewStatus !== "reviewed") return false;
  if (loc.meta.sourceContentHash !== item.canonical.contentHash) return false;
  if (isRetracted(item)) return false;
  return true;
}

/** True when this item has an active retraction record. */
export function isRetracted(item: NewsItem): boolean {
  return item.canonical.reviewStatus === "retracted" || retractedPaths().has(`content/news/${item.slug}/index.md`);
}

/**
 * Resolve a display locale: strict real translation, else fall back to the
 * source language (index.md). `translated` distinguishes fallback rendering.
 */
export function resolveLocale(
  item: NewsItem,
  lang: LocaleLang,
): { body: string; translated: boolean } {
  if (isRealTranslation(item, lang)) {
    const loc = item.locales[lang]!;
    return { body: loc.body, translated: true };
  }
  return { body: item.canonicalBody, translated: false };
}

/** True when a strict real translation exists for this lang. */
export function hasTranslation(item: NewsItem, lang: LocaleLang): boolean {
  return isRealTranslation(item, lang);
}
