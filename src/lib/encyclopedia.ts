import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import matter from "gray-matter";

import { ContentPackageError, getActiveRetractionPaths, getContentRoot, readEmbeddedPackageFile } from "./content.ts";
import { embeddedPackage } from "./embedded-package.ts";
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
  reviewedBy: string | null;
  reviewedAt: string | null;
  sourceId: string;
  sourceItemId: string;
  contentHash: string;
  lang: "ja";
}

export interface ProfileLocale {
  lang: "zh" | "en";
  title: string;
  facts: ProfileFacts;
  body: string;
  reviewStatus: "draft" | "reviewed" | "stale" | "retracted";
  reviewedBy: string | null;
  reviewedAt: string | null;
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

interface ProfileHistoryEvent {
  sequence: number;
  event_id: string;
  operation_id: string;
  scope: "canonical" | "locale";
  lang: "ja" | "zh" | "en" | null;
  from: string | null;
  to: "draft" | "reviewed" | "stale" | "retracted" | string;
  actor: string;
  actor_kind: string;
  at: string;
  reason: string;
  source_content_hash: string;
  content_hash: string | null;
}

interface ProfileHistory {
  history_version: string;
  identity: string;
  events: ProfileHistoryEvent[];
}

const CONTENT_FILE_RE = /^content\.(ja|zh|en)\.md$/;
const ENCYCLOPEDIA_DIR = "encyclopedia";

/**
 * Deterministic semantic content_hash for a canonical encyclopedia profile.
 * The frozen normalized payload is an ordered UTF-8 JSON array of the exact
 * frontmatter values + trimmed body, in the locked field order below.
 * Returns "sha256:<64 hex>".
 */
export function profileCanonicalContentHash(d: Record<string, unknown>, body: string): string {
  const payload = JSON.stringify([
    d.source_id,
    d.source_item_id,
    d.lang,
    d.source_url,
    d.retrieved_at,
    d.title,
    d.tagline,
    d.name_ja,
    d.name_roman,
    d.cv,
    d.affiliation,
    d.type,
    d.age,
    d.birthday,
    d.blood_type,
    d.constellation,
    d.handedness,
    d.height,
    d.weight,
    d.three_sizes,
    d.birthplace,
    d.hobby,
    d.specialty,
    d.likes,
    body,
  ]);
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

/**
 * Deterministic semantic content_hash for a locale encyclopedia profile.
 * The frozen normalized payload is the ordered UTF-8 JSON array binding the
 * locale's source_content_hash (== canonical content_hash) to its own values
 * and trimmed body, in the locked field order below.
 * Returns "sha256:<64 hex>".
 */
export function profileLocaleContentHash(d: Record<string, unknown>, body: string): string {
  const payload = JSON.stringify([
    d.lang,
    d.source_content_hash,
    d.title,
    d.tagline,
    d.name,
    d.name_roman,
    d.cv,
    d.affiliation,
    d.type,
    d.age,
    d.birthday,
    d.blood_type,
    d.constellation,
    d.handedness,
    d.height,
    d.weight,
    d.three_sizes,
    d.birthplace,
    d.hobby,
    d.specialty,
    d.likes,
    body,
  ]);
  return `sha256:${createHash("sha256").update(payload, "utf8").digest("hex")}`;
}

/**
 * Validate that a reviewed encyclopedia bundle's editorial history closes its
 * authorization metadata. Fail-closed for any reviewed canonical/locale:
 * required fields, version/identity, strictly increasing unique
 * sequence/event_id/operation_id, and a latest human review event per
 * scope/lang whose actor/at/content_hash/source_content_hash exactly match
 * the frontmatter and canonical hash linkage.
 */
function assertHistoryClosesReview(
  history: unknown,
  canonicalFrontmatter: Record<string, unknown>,
  canonicalContentHash: string,
  canonicalReview: { reviewedBy: string | null; reviewedAt: string | null },
  locales: Partial<Record<"zh" | "en", { review: { reviewedBy: string | null; reviewedAt: string | null }; contentHash: string }>>,
): void {
  if (history === null || typeof history !== "object") {
    throw new ContentPackageError(
      "content_package_history_required",
      "reviewed profile requires an editorial-history.json",
    );
  }
  const h = history as ProfileHistory;
  if (h.history_version !== "1") {
    throw new ContentPackageError(
      "content_package_history_version",
      `editorial history must declare history_version "1", got ${String(h.history_version)}`,
    );
  }
  const identity = `${String(canonicalFrontmatter.source_id ?? "")}|${String(canonicalFrontmatter.source_item_id ?? "")}`;
  if (h.identity !== identity) {
    throw new ContentPackageError(
      "content_package_history_identity",
      `editorial history identity ${JSON.stringify(h.identity)} must equal ${JSON.stringify(identity)}`,
    );
  }
  if (!Array.isArray(h.events)) {
    throw new ContentPackageError("content_package_history_events", "editorial history must have an events array");
  }
  const seqSeen = new Set<number>();
  const idSeen = new Set<string>();
  const opSeen = new Set<string>();
  let prevSeq = -1;
  const knownActorKinds = new Set(["human", "ai", "system"]);
  const knownScopes = new Set(["canonical", "locale"]);
  const knownLangs = new Set(["ja", "zh", "en"]);
  const knownTos = new Set(["draft", "reviewed", "stale", "retracted"]);
  const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  for (const ev of h.events) {
    if (typeof ev?.sequence !== "number" || !Number.isInteger(ev.sequence) || ev.sequence <= prevSeq) {
      throw new ContentPackageError(
        "content_package_history_sequence",
        `editorial history events must have strictly increasing integer sequence (saw ${JSON.stringify(ev?.sequence)})`,
      );
    }
    if (typeof ev.event_id !== "string" || !uuidRe.test(ev.event_id)) {
      throw new ContentPackageError(
        "content_package_history_event_id",
        `editorial history event_id must be an RFC 4122 UUID text (saw ${JSON.stringify(ev.event_id)})`,
      );
    }
    if (typeof ev.operation_id !== "string" || ev.operation_id.length === 0) {
      throw new ContentPackageError(
        "content_package_history_operation_id",
        `editorial history operation_id must be a non-empty string (saw ${JSON.stringify(ev.operation_id)})`,
      );
    }
    if (typeof ev.actor !== "string" || ev.actor.length === 0) {
      throw new ContentPackageError(
        "content_package_history_actor",
        `editorial history actor must be a non-empty string (saw ${JSON.stringify(ev.actor)})`,
      );
    }
    if (typeof ev.reason !== "string" || ev.reason.length === 0) {
      throw new ContentPackageError(
        "content_package_history_reason",
        `editorial history reason must be a non-empty string (saw ${JSON.stringify(ev.reason)})`,
      );
    }
    if (typeof ev.source_content_hash !== "string" || ev.source_content_hash.length === 0) {
      throw new ContentPackageError(
        "content_package_history_source_hash",
        `editorial history source_content_hash must be a non-empty string (saw ${JSON.stringify(ev.source_content_hash)})`,
      );
    }
    if (typeof ev.content_hash !== "string" || ev.content_hash.length === 0) {
      throw new ContentPackageError(
        "content_package_history_content_hash",
        `editorial history content_hash must be a non-empty string (saw ${JSON.stringify(ev.content_hash)})`,
      );
    }
    if (!knownActorKinds.has(ev.actor_kind)) {
      throw new ContentPackageError(
        "content_package_history_actor_kind",
        `editorial history actor_kind must be one of human|ai|system (saw ${JSON.stringify(ev.actor_kind)})`,
      );
    }
    if (!knownScopes.has(ev.scope)) {
      throw new ContentPackageError(
        "content_package_history_scope",
        `editorial history scope must be canonical|locale (saw ${JSON.stringify(ev.scope)})`,
      );
    }
    if (ev.lang !== null && !knownLangs.has(ev.lang)) {
      throw new ContentPackageError(
        "content_package_history_lang",
        `editorial history lang must be ja|zh|en or null (saw ${JSON.stringify(ev.lang)})`,
      );
    }
    if (ev.to === undefined || !knownTos.has(ev.to)) {
      throw new ContentPackageError(
        "content_package_history_to",
        `editorial history to must be draft|reviewed|stale|retracted (saw ${JSON.stringify(ev.to)})`,
      );
    }
    if (typeof ev.at !== "string" || Number.isNaN(Date.parse(ev.at)) || !/T\d{2}:\d{2}/.test(ev.at)) {
      throw new ContentPackageError(
        "content_package_history_at",
        `editorial history at must be a valid date-time (saw ${JSON.stringify(ev.at)})`,
      );
    }
    if (seqSeen.has(ev.sequence) || idSeen.has(ev.event_id) || opSeen.has(ev.operation_id)) {
      throw new ContentPackageError(
        "content_package_history_duplicate",
        `editorial history must have unique sequence/event_id/operation_id (sequence ${ev.sequence})`,
      );
    }
    seqSeen.add(ev.sequence);
    idSeen.add(ev.event_id);
    opSeen.add(ev.operation_id);
    prevSeq = ev.sequence;
  }

  const expectReviewed = (scope: "canonical" | "locale", lang: string, review: { reviewedBy: string | null; reviewedAt: string | null }, contentHash: string, sourceHash: string, ctx: string): void => {
    const matching = h.events.filter((e) => e.scope === scope && e.lang === lang);
    const latest = matching.length === 0 ? undefined : matching[matching.length - 1];
    if (!latest || latest.to !== "reviewed") {
      throw new ContentPackageError(
        "content_package_history_review_missing",
        `${ctx} is reviewed but history lacks a latest reviewed event for scope=${scope} lang=${lang}`,
      );
    }
    if (latest.actor_kind !== "human") {
      throw new ContentPackageError(
        "content_package_history_review_actor_kind",
        `${ctx} review event must have actor_kind=human, got ${latest.actor_kind}`,
      );
    }
    if (latest.actor !== review.reviewedBy || latest.at !== review.reviewedAt) {
      throw new ContentPackageError(
        "content_package_history_review_actor",
        `${ctx} review event actor/at must exactly match frontmatter reviewed_by/reviewed_at`,
      );
    }
    if (latest.content_hash !== contentHash) {
      throw new ContentPackageError(
        "content_package_history_review_hash",
        `${ctx} review event content_hash must exactly match the frontmatter content_hash`,
      );
    }
    if (latest.source_content_hash !== sourceHash) {
      throw new ContentPackageError(
        "content_package_history_review_source_hash",
        `${ctx} review event source_content_hash must exactly match the canonical content_hash`,
      );
    }
  };

  expectReviewed(
    "canonical",
    "ja",
    canonicalReview,
    canonicalContentHash,
    canonicalContentHash,
    "canonical",
  );
  for (const lang of ["zh", "en"] as const) {
    const loc = locales[lang];
    if (!loc) continue;
    expectReviewed(
      "locale",
      lang,
      loc.review,
      loc.contentHash,
      canonicalContentHash,
      `locale ${lang}`,
    );
  }
}

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
      const expectedHash = profileCanonicalContentHash(d, content.trim());
      if (String(d.content_hash ?? "") !== expectedHash) {
        throw new ContentPackageError(
          "content_package_canonical_hash_mismatch",
          `${rel} content_hash ${String(d.content_hash ?? "")} does not match its normalized semantic payload (expected ${expectedHash})`,
        );
      }
      canonical = {
        title: String(d.title ?? ""),
        facts: normalizeFacts(d),
        body: content.trim(),
        sourceUrl: String(d.source_url ?? ""),
        reviewStatus: d.review_status as ProfileCanonical["reviewStatus"],
        reviewedBy: (d.reviewed_by as string | null | undefined) ?? null,
        reviewedAt: (d.reviewed_at as string | null | undefined) ?? null,
        sourceId: String(d.source_id ?? ""),
        sourceItemId: String(d.source_item_id ?? ""),
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
      const expectedHash = profileLocaleContentHash(d, content.trim());
      if (String(d.content_hash ?? "") !== expectedHash) {
        throw new ContentPackageError(
          "content_package_locale_hash_mismatch",
          `${rel} content_hash ${String(d.content_hash ?? "")} does not match its normalized semantic payload (expected ${expectedHash})`,
        );
      }
      locales[lang as "zh" | "en"] = {
        lang: lang as "zh" | "en",
        title: String(d.title ?? ""),
        facts: normalizeFacts(d),
        body: content.trim(),
        reviewStatus: d.review_status as ProfileLocale["reviewStatus"],
        reviewedBy: (d.reviewed_by as string | null | undefined) ?? null,
        reviewedAt: (d.reviewed_at as string | null | undefined) ?? null,
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

  // Reviewed canonical or locale bundles must close their authorization metadata
  // through the editorial history (fail-closed). Draft bundles need no review
  // event; a missing history file is only an error once something is reviewed.
  const anyReviewed =
    canonical.reviewStatus === "reviewed" ||
    (["zh", "en"] as const).some((lang) => locales[lang]?.reviewStatus === "reviewed");
  if (anyReviewed) {
    const historyRel = path.posix.join(bundleRel, "editorial-history.json");
    let history: unknown;
    try {
      history = JSON.parse(readFile(historyRel));
    } catch (err) {
      throw new ContentPackageError(
        "content_package_history_required",
        `reviewed profile requires a readable editorial-history.json: ${historyRel} (${(err as Error).message})`,
      );
    }
    const locReviews: Partial<Record<"zh" | "en", { review: { reviewedBy: string | null; reviewedAt: string | null }; contentHash: string }>> = {};
    for (const lang of ["zh", "en"] as const) {
      const loc = locales[lang];
      if (!loc) continue;
      if (loc.reviewStatus !== "reviewed") continue;
      locReviews[lang] = {
        review: { reviewedBy: loc.reviewedBy, reviewedAt: loc.reviewedAt },
        contentHash: loc.contentHash,
      };
    }
    assertHistoryClosesReview(
      history,
      { source_id: canonical.sourceId, source_item_id: canonical.sourceItemId },
      canonical.contentHash,
      { reviewedBy: canonical.reviewedBy, reviewedAt: canonical.reviewedAt },
      locReviews,
    );
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

function loadEmbeddedProfileItem(dir: string): ProfileItem {
  const contentRoot = "content";
  const readFile = (rel: string) => readEmbeddedPackageFile(rel.replaceAll("\\", "/"));
  // dir is already content-relative (e.g. encyclopedia/momoko-suou).
  const bundleRel = dir.replace(/\\/g, "/");
  const listNames = (bundleDir: string): string[] => {
    const prefix = `${bundleDir.replace(/\\/g, "/")}/`;
    const names = new Set<string>();
    for (const file of Object.keys(embeddedPackage.files)) {
      const normalized = file.replace(/\\/g, "/");
      if (!normalized.startsWith(prefix)) continue;
      const rest = normalized.slice(prefix.length);
      if (rest.includes("/")) continue;
      names.add(rest);
    }
    return [...names];
  };
  return loadBundleItem(contentRoot, dir, readFile, listNames, bundleRel);
}

/** Scan content/encyclopedia/** and load every canonical profile. */
export function loadProfiles(): ProfileItem[] {
  if (embeddedPackage.enabled) {
    // Embedded path: enumerate encyclopedia bundles from the build file map.
    const dirs = new Set<string>();
    for (const file of Object.keys(embeddedPackage.files)) {
      if (!file.startsWith("encyclopedia/")) continue;
      if (file.endsWith("/index.md")) {
        throw new ContentPackageError(
          "content_package_legacy_index",
          `legacy index.md is not allowed (use content.<lang>.md): ${file}`,
        );
      }
      if (CONTENT_FILE_RE.test(file.slice(file.lastIndexOf("/") + 1))) {
        dirs.add(file.slice(0, file.lastIndexOf("/")));
      }
    }
    return [...dirs].sort().map((dir) => loadEmbeddedProfileItem(dir));
  }
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
function isProfileCurrentReviewed(item: ProfileItem, retracted: Set<string>): boolean {
  if (item.canonical.reviewStatus !== "reviewed") return false;
  if (item.canonical.body.length === 0) return false;
  return !retracted.has(canonicalPathOf(item));
}

/**
 * True when lang resolves to a real translation of a current-reviewed profile:
 * canonical current-reviewed (not retracted) + locale reviewed + nonempty body
 * + locale sourceContentHash == canonical contentHash.
 * Always reads the current active retraction records; callers cannot bypass.
 */
export function isRealProfileTranslation(item: ProfileItem, lang: "ja" | "zh" | "en"): boolean {
  if (lang === "ja") return false;
  const retracted = getActiveRetractionPaths();
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
