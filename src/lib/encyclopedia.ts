import fs from "node:fs";
import path from "node:path";
import matter from "gray-matter";

import { ContentPackageError, getContentRoot } from "./content.ts";
import { validateFile } from "../../tools/schema/validate.ts";

/** Facts locked by the frozen task #50 inventory (schema-required, additionalProperties=false). */
export interface ProfileFacts {
  nameJa: string;
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
  lang: "ja";
}

export interface ProfileItem {
  slug: string;
  canonical: ProfileCanonical;
}

const CONTENT_FILE_RE = /^content\.(ja|zh|en)\.md$/;
const ENCYCLOPEDIA_DIR = "encyclopedia";

function normalizeFacts(d: Record<string, unknown>): ProfileFacts {
  return {
    nameJa: String(d.name_ja ?? ""),
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
        lang: "ja",
      };
    } else if (d.is_canonical !== false) {
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

  const prefix = `${ENCYCLOPEDIA_DIR}/`;
  const slug = bundleRel.startsWith(prefix)
    ? bundleRel.slice(prefix.length)
    : bundleRel;
  return { slug, canonical };
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

/** Profiles eligible for the public encyclopedia surface (reviewed only). */
export function loadPublishedProfiles(): ProfileItem[] {
  return loadProfiles().filter((p) => p.canonical.reviewStatus === "reviewed");
}
