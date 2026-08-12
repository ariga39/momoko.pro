import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import { ContentPackageError, getActiveRetractionPaths, getContentRoot } from "./content.ts";
import { validateFile } from "../../tools/schema/validate.ts";

/** Facts locked by the frozen task #50 inventory (18 semantic fields). */
export interface ProfileFacts {
  name: string;
  nameRoman: string;
  cv: string;
  affiliation: string;
  type: string;
  age: string;
  birthday: string;
  bloodType: string;
  constellation: string;
  handedness: string;
  height: string;
  weight: string;
  threeSizes: string;
  birthplace: string;
  hobby: string;
  specialty: string;
  likes: string;
  tagline: string;
}

export interface ProfileCanonical {
  title: string;
  facts: ProfileFacts;
  body: string;
  sourceUrl: string;
  reviewStatus: "draft" | "reviewed" | "stale" | "retracted";
  contentHash: string;
  lang: "ja";
}

export interface ProfileLocale {
  lang: "zh" | "en";
  title: string;
  facts: ProfileFacts;
  body: string;
  reviewStatus: "draft" | "reviewed" | "stale" | "retracted";
  contentPath: string;
  sourceContentHash: string;
  contentHash: string;
}

export interface ProfileResolvedLocale {
  lang: "ja" | "zh" | "en";
  title: string;
  facts: ProfileFacts;
  body: string;
  translated: boolean;
}

export interface ProfileItem {
  slug: string;
  canonical: ProfileCanonical;
  locales: Partial<Record<"zh" | "en", ProfileLocale>>;
}

const CONTENT_FILE_RE = /^content\.(ja|zh|en)\.md$/;
const ENCYCLOPEDIA_DIR = "encyclopedia";

function normalizeFacts(d: Record<string, unknown>): ProfileFacts {
  return {
    name: String(d.name ?? d.name_ja ?? ""),
    nameRoman: String(d.name_roman ?? ""),
    cv: String(d.cv ?? ""),
    affiliation: String(d.affiliation ?? ""),
    type: String(d.type ?? ""),
    age: String(d.age ?? ""),
    birthday: String(d.birthday ?? ""),
    bloodType: String(d.blood_type ?? ""),
    constellation: String(d.constellation ?? ""),
    handedness: String(d.handedness ?? ""),
    height: String(d.height ?? ""),
    weight: String(d.weight ?? ""),
    threeSizes: String(d.three_sizes ?? ""),
    birthplace: String(d.birthplace ?? ""),
    hobby: String(d.hobby ?? ""),
    specialty: String(d.specialty ?? ""),
    likes: String(d.likes ?? ""),
    tagline: String(d.tagline ?? ""),
  };
}

function loadBundleItem(
  contentRoot: string,
  dir: string,
  readFile: (rel: string) => string,
  listNames: (dir: string) => string[],
  bundleRel: string,
): ProfileItem {
  const names = listNames(dir);
  const legacy = names.find((n) => n === "index.md");
  if (legacy) {
    throw new ContentPackageError(
      "content_package_legacy_index",
      `legacy index.md is not allowed (use content.<lang>.md): ${path.relative(contentRoot, path.join(dir, legacy))}`,
    );
  }
  const contentFiles = names.filter((n) => CONTENT_FILE_RE.test(n));
  const unknown = names.filter(
    (n) => n !== "editorial-history.json" && !CONTENT_FILE_RE.test(n) && n !== "index.md",
  );
  if (unknown.length > 0) {
    throw new ContentPackageError(
      "content_package_entry_unsupported",
      `unsupported encyclopedia entry: ${path.relative(contentRoot, path.join(dir, unknown[0]!))}`,
    );
  }
  if (contentFiles.length === 0) {
    throw new ContentPackageError(
      "content_package_bundle_no_content",
      `encyclopedia bundle has no content.<lang>.md file: ${path.relative(contentRoot, dir)}`,
    );
  }

  let canonical: ProfileCanonical | null = null;
  const locales: Partial<Record<"zh" | "en", ProfileLocale>> = {};

  for (const name of contentFiles) {
    const lang = name.match(/^content\.(ja|zh|en)\.md$/)![1] as "ja" | "zh" | "en";
    const rel = path.posix.join(bundleRel, name);
    const { data, content } = matter(readFile(rel));
    const d = data as Record<string, unknown>;
    if (d.lang !== lang) {
      throw new ContentPackageError(
        "content_package_lang_mismatch",
        `filename ${name} lang does not match frontmatter lang: ${rel}`,
      );
    }
    const record = { ...d, body: content.trim() };
    if (d.is_canonical === true) {
      if (canonical) {
        throw new ContentPackageError(
          "content_package_multi_canonical",
          `multiple canonical files in bundle: ${path.relative(contentRoot, dir)}`,
        );
      }
      const checked = validateFile("encyclopedia-profile.schema.json", record);
      if (!checked.valid) {
        throw new ContentPackageError(
          "content_package_content_invalid",
          `${rel} failed encyclopedia profile schema validation: ${checked.errors ?? "invalid"}`,
        );
      }
      canonical = {
        title: String(d.title ?? ""),
        facts: normalizeFacts(d),
        body: content.trim(),
        sourceUrl: String(d.source_url ?? ""),
        reviewStatus: d.review_status as ProfileCanonical["reviewStatus"],
        contentHash: String(d.content_hash ?? ""),
        lang: lang as "ja",
      };
    } else if (d.is_canonical === false) {
      const checked = validateFile("encyclopedia-profile-locale.schema.json", record);
      if (!checked.valid) {
        throw new ContentPackageError(
          "content_package_locale_invalid",
          `${rel} failed encyclopedia profile locale schema validation: ${checked.errors ?? "invalid"}`,
        );
      }
      locales[lang as "zh" | "en"] = {
        lang: lang as "zh" | "en",
        title: String(d.title ?? ""),
        facts: normalizeFacts(d),
        body: content.trim(),
        reviewStatus: d.review_status as ProfileLocale["reviewStatus"],
        contentPath: String(d.content_path ?? ""),
        sourceContentHash: String(d.source_content_hash ?? ""),
        contentHash: String(d.content_hash ?? ""),
      };
    } else {
      throw new ContentPackageError(
        "content_package_canonical_invalid",
        `${rel} is_canonical must be true or false`,
      );
    }
  }

  if (!canonical) {
    throw new ContentPackageError(
      "content_package_no_canonical",
      `encyclopedia bundle has no canonical content.<lang>.md (is_canonical=true): ${path.relative(contentRoot, dir)}`,
    );
  }

  // Exact cross-bundle content_path binding: every locale content_path must
  // exactly point to this bundle's canonical file.
  const canonicalRel = `content/${bundleRel}/content.${canonical.lang}.md`;
  for (const lang of Object.keys(locales) as ("zh" | "en")[]) {
    const loc = locales[lang]!;
    if (loc.contentPath !== canonicalRel) {
      throw new ContentPackageError(
        "content_package_locale_path_mismatch",
        `${lang} content_path must exactly point to the bundle canonical (${canonicalRel}), got ${loc.contentPath}`,
      );
    }
  }

  const prefix = `${ENCYCLOPEDIA_DIR}/`;
  const slug = bundleRel.startsWith(prefix)
    ? bundleRel.slice(prefix.length)
    : bundleRel;
  return { slug, canonical, locales };
}

function listBundleFileNames(dir: string): string[] {
  const files = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of files) {
    if (entry.isSymbolicLink()) {
      throw new ContentPackageError("content_package_symlink", `symlink in content package: ${entry.name}`);
    }
  }
  return files.map((entry) => entry.name);
}

/** Scan content/encyclopedia/** and load every canonical profile (filesystem). */
export function loadProfiles(): ProfileItem[] {
  const contentRoot = getContentRoot();
  const encyclopediaRoot = path.join(contentRoot, ENCYCLOPEDIA_DIR);
  if (!fs.existsSync(encyclopediaRoot)) return [];
  if (fs.lstatSync(encyclopediaRoot).isSymbolicLink() || !fs.statSync(encyclopediaRoot).isDirectory()) {
    throw new ContentPackageError("content_package_encyclopedia_invalid", "encyclopedia must be a real directory");
  }
  const out: ProfileItem[] = [];
  const bundleDirs = new Set<string>();
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
          throw new ContentPackageError(
            "content_package_legacy_index",
            `legacy index.md is not allowed (use content.<lang>.md): ${path.relative(contentRoot, full)}`,
          );
        }
        if (CONTENT_FILE_RE.test(entry.name)) {
          bundleDirs.add(dir);
        } else if (entry.name !== "editorial-history.json") {
          throw new ContentPackageError("content_package_entry_unsupported", `unsupported encyclopedia entry: ${path.relative(contentRoot, full)}`);
        }
      }
    }
  };
  walk(encyclopediaRoot);
  const seen = new Set<string>();
  for (const dir of bundleDirs) {
    if (seen.has(dir)) continue;
    seen.add(dir);
    const readFile = (rel: string) => fs.readFileSync(path.join(contentRoot, rel), "utf8");
    const bundleRel = path.relative(contentRoot, dir).split(path.sep).join("/");
    out.push(loadBundleItem(contentRoot, dir, readFile, listBundleFileNames, bundleRel));
  }
  return out.sort((a, b) => a.slug.localeCompare(b.slug));
}

/** Profiles eligible for the public encyclopedia surface (current-reviewed + not retracted). */
export function loadPublishedProfiles(): ProfileItem[] {
  const retracted = getActiveRetractionPaths();
  return loadProfiles().filter((p) => isProfileCurrentReviewed(p, retracted));
}

/** Canonical repo path used by retraction records and cross-bundle binding. */
function canonicalPathOf(item: ProfileItem): string {
  return `content/encyclopedia/${item.slug}/content.${item.canonical.lang}.md`;
}

/** True when the canonical is current-reviewed and not under an active retraction. */
export function isProfileCurrentReviewed(item: ProfileItem, retracted: Set<string>): boolean {
  if (item.canonical.reviewStatus !== "reviewed") return false;
  if (item.canonical.body.length === 0) return false;
  return !retracted.has(canonicalPathOf(item));
}

/**
 * True when lang resolves to a real translation of a current-reviewed profile:
 * canonical current-reviewed (not retracted) + locale reviewed + nonempty body
 * + locale sourceContentHash == canonical contentHash.
 */
export function isRealProfileTranslation(
  item: ProfileItem,
  lang: "ja" | "zh" | "en",
  retracted: Set<string> = getActiveRetractionPaths(),
): boolean {
  if (lang === "ja") return false;
  const loc = item.locales[lang as "zh" | "en"];
  return (
    isProfileCurrentReviewed(item, retracted) &&
    loc !== undefined &&
    loc.reviewStatus === "reviewed" &&
    loc.body.length > 0 &&
    loc.sourceContentHash === item.canonical.contentHash
  );
}

/**
 * Resolve the effective locale for a profile at a requested lang.
 * Returns a real translation only when isRealProfileTranslation holds;
 * otherwise returns the canonical fallback with translated:false (never null).
 */
export function resolveProfileLocale(item: ProfileItem, lang: "ja" | "zh" | "en"): ProfileResolvedLocale {
  if (isRealProfileTranslation(item, lang)) {
    const loc = item.locales[lang as "zh" | "en"]!;
    return {
      lang: loc.lang,
      title: loc.title,
      facts: loc.facts,
      body: loc.body,
      translated: true,
    };
  }
  return {
    lang: item.canonical.lang,
    title: item.canonical.title,
    facts: item.canonical.facts,
    body: item.canonical.body,
    translated: false,
  };
}
