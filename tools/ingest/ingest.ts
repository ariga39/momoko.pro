/**
 * momoko.pro Phase 2B ingestion seam (task #7, 翼（tsubasa）).
 *
 * Unified terms-gated source adapters, normalized discovery records,
 * content fingerprint/dedup, silent no-change runs, and PR-ready synthetic
 * drafts. External pages are treated as untrusted input: adapters only carry
 * human fact-notes / approved excerpts — never auto-summarized body text.
 *
 * Contract (design §5.2/§5.3, momoko automation ceiling):
 * - cron only runs adapters for sources with `automated_fetch=true`, explicit
 *   fetch paths, and a path-bound robots decision for every target;
 *   S1–S5 all false => silent no-op.
 * - manual-import validates a discovery record against
 *   `schemas/discovery-record.schema.json`; identity = (source_id,
 *   source_item_id, lang); content_hash is a VERSION, so a changed draft
 *   becomes an explicit successor (index-vN.md), never an overwrite.
 * - failures are structured `{error, code}`; a single atomic write per
 *   identity means no partial artifacts (state is derived from files).
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import matter from "gray-matter";
import yaml from "js-yaml";

import { REPO_ROOT, validateFile } from "../schema/validate.ts";

export const INGEST_ROOT = path.join(REPO_ROOT, "tools", "ingest");
export const DRAFT_ROOT = path.join(REPO_ROOT, ".ingest-drafts");

/** Stable machine codes for structured failures (mirrors market layer style). */
export type IngestCode =
  | "ok"
  | "rate_limited"
  | "forbidden"
  | "schema_changed"
  | "unavailable"
  | "not_found"
  | "invalid_record"
  | "duplicate"
  | "terms_not_allowed"
  | "no_allowed_sources";

export interface DiscoveryItem {
  source_id: string;
  source_item_id: string;
  source_url: string;
  published_at: string;
  title: string;
  lang: "ja" | "zh" | "en";
  note: string;
  note_hash: string;
}

export interface FetchResult {
  ok: boolean;
  items: DiscoveryItem[];
  error?: string;
  code?: IngestCode;
}

export interface SourceAdapter {
  readonly source_id: string;
  /** Fetch one explicitly authorized path. Never executes untrusted payloads. */
  fetch(source: Record<string, unknown>, requestedPath: string): Promise<FetchResult>;
}

const _adapters = new Map<string, SourceAdapter>();

export function registerSourceAdapter(adapter: SourceAdapter): void {
  _adapters.set(adapter.source_id, adapter);
}

export function sourceAdapterFor(source_id: string): SourceAdapter | undefined {
  return _adapters.get(source_id);
}

export function resetAdapters(): void {
  _adapters.clear();
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export function contentHash(item: DiscoveryItem): string {
  const canonical = JSON.stringify(
    [
      item.source_id,
      item.source_item_id,
      item.lang,
      item.source_url,
      item.published_at,
      item.title,
      item.note,
    ],
  );
  return sha256(canonical);
}

export interface SourceConfig {
  source_id: string;
  automated_fetch: boolean;
  fetch_frequency: string;
  fetch_paths?: string[];
  robots_http?: string | number | null;
  robots_result?: RobotsResult;
  robots_path_decision?: RobotsPathDecision;
  checked_path?: string | null;
  retrieved_at?: string | null;
  evidence?: string | null;
  robots_note?: string;
  terms_note?: string;
  access_control?: AccessControl;
  terms_status?: TermsStatus;
  robots_approved?: { allowed: boolean; evidence: string };
  terms_approved?: { allowed: boolean; evidence: string };
  canonical_url?: string;
  [k: string]: unknown;
}

export function loadSources(sourcesPath?: string): SourceConfig[] {
  const p = sourcesPath ?? path.join(REPO_ROOT, "config", "sources.json");
  const cfg = JSON.parse(fs.readFileSync(p, "utf8"));
  return cfg.sources as SourceConfig[];
}

export type RobotsResult = "rules_available" | "unavailable" | "unreachable" | "not_applicable";
export type RobotsPathDecision = "allow" | "disallow" | "no_match" | "not_evaluated";
export type SourceAccessMode =
  | "human_directed_single_page"
  | "scheduled_or_recursive_crawler"
  | "reuse_or_republication";
export type AccessControl = "public" | "login_required" | "paywall" | "captcha" | "explicitly_blocked";
export type TermsStatus = "not_evaluated" | "permitted" | "prohibited";

function isAccessControl(value: unknown): value is AccessControl {
  return typeof value === "string" && ["public", "login_required", "paywall", "captcha", "explicitly_blocked"].includes(value);
}

function isTermsStatus(value: unknown): value is TermsStatus {
  return typeof value === "string" && ["not_evaluated", "permitted", "prohibited"].includes(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

/** A fetch target is an origin-relative URL path, never a query or fragment. */
export function isFetchPath(value: unknown): value is string {
  return Boolean(
    typeof value === "string" &&
      value.length > 0 &&
      value.startsWith("/") &&
      !value.includes("?") &&
      !value.includes("#") &&
      !value.includes("//") &&
      !value.split("/").some((part) => part === "." || part === ".."),
  );
}

export interface SourceAccessRequest {
  access_mode: SourceAccessMode;
  automated_fetch: boolean;
  robots_result?: RobotsResult;
  robots_path_decision?: RobotsPathDecision;
  checked_path?: string | null;
  requested_path?: string | null;
  retrieved_at?: string | null;
  evidence?: string | null;
  access_control?: AccessControl;
  terms_status?: TermsStatus;
  reuse_permitted?: boolean;
  citation_boundary?: boolean;
}

export interface SourceAccessDecision {
  allowed: boolean;
  reason: string;
}

function denied(reason: string): SourceAccessDecision {
  return { allowed: false, reason };
}

function commonAccessDecision(request: SourceAccessRequest): SourceAccessDecision | null {
  if (!isAccessControl(request.access_control)) return denied("access_control_missing_or_invalid");
  if (request.access_control !== "public") return denied("access_control_blocked");
  if (!isTermsStatus(request.terms_status)) return denied("terms_status_missing_or_invalid");
  if (request.terms_status === "prohibited") return denied("explicit_terms_prohibited");
  return null;
}

function hasPathBoundEvidence(request: SourceAccessRequest): boolean {
  return Boolean(
    isFetchPath(request.requested_path) &&
      isFetchPath(request.checked_path) &&
      request.checked_path === request.requested_path &&
      isNonEmptyString(request.retrieved_at) &&
      isNonEmptyString(request.evidence),
  );
}

function robotsStateError(request: SourceAccessRequest): string | null {
  if (!request.robots_result || !request.robots_path_decision) {
    return "robots_decision_missing";
  }
  if (!("rules_available" === request.robots_result || "unavailable" === request.robots_result || "unreachable" === request.robots_result || "not_applicable" === request.robots_result)) {
    return "robots_result_invalid";
  }
  if (!("allow" === request.robots_path_decision || "disallow" === request.robots_path_decision || "no_match" === request.robots_path_decision || "not_evaluated" === request.robots_path_decision)) {
    return "robots_path_decision_invalid";
  }
  if (request.robots_result === "not_applicable") {
    if (
      request.robots_path_decision !== "not_evaluated" ||
      request.checked_path !== null ||
      request.retrieved_at !== null ||
      request.evidence !== null
    ) {
      return "robots_not_applicable_state_invalid";
    }
    return null;
  }
  if (!hasPathBoundEvidence(request)) return "robots_path_evidence_missing_or_mismatched";
  if (request.robots_result === "rules_available" && request.robots_path_decision === "not_evaluated") {
    return "robots_rules_path_not_evaluated";
  }
  if (request.robots_result === "unavailable" && request.robots_path_decision !== "allow") {
    return "robots_unavailable_requires_allow";
  }
  if (request.robots_result === "unreachable" && request.robots_path_decision !== "disallow") {
    return "robots_unreachable_requires_disallow";
  }
  return null;
}

/**
 * Pure access decision for the three deliberately separate access modes.
 * robots_result is a file/result class; robots_path_decision is only for the
 * bound checked_path. Legacy robots_approved is intentionally not accepted.
 */
export function decideSourceAccess(request: SourceAccessRequest): SourceAccessDecision {
  if (!(["human_directed_single_page", "scheduled_or_recursive_crawler", "reuse_or_republication"] as string[]).includes(request.access_mode)) {
    return denied("access_mode_invalid");
  }
  const common = commonAccessDecision(request);
  if (common) return common;

  if (request.access_mode === "human_directed_single_page") {
    return { allowed: true, reason: "human_directed_single_page_allowed" };
  }

  if (request.access_mode === "reuse_or_republication") {
    if (request.reuse_permitted !== true || request.citation_boundary !== true) {
      return denied("reuse_permission_or_citation_boundary_missing");
    }
    return { allowed: true, reason: "reuse_permission_and_citation_boundary_present" };
  }

  if (!isFetchPath(request.requested_path)) return denied("requested_path_invalid");
  if (request.automated_fetch !== true) return denied("automated_fetch_disabled");
  const stateError = robotsStateError(request);
  if (stateError) return denied(stateError);
  if (request.robots_result === "unreachable") return denied("robots_unreachable_disallow");
  if (request.robots_result === "not_applicable") {
    return { allowed: true, reason: "robots_not_applicable" };
  }
  if (request.robots_path_decision === "disallow") return denied("robots_path_disallow");
  return { allowed: true, reason: "crawler_path_allowed" };
}

/**
 * Compatibility wrapper for the cron seam. The old robots_approved field is
 * loaded when present for old configs, but it is not read here. Missing new
 * result/path evidence fails closed for crawler access.
 */
export function sourceAllowedToFetch(source: SourceConfig, requestedPath: string): boolean {
  if (!isFetchPath(requestedPath)) return false;
  if (!isAccessControl(source.access_control) || !isTermsStatus(source.terms_status)) return false;
  return decideSourceAccess({
    access_mode: "scheduled_or_recursive_crawler",
    automated_fetch: source.automated_fetch,
    requested_path: requestedPath,
    access_control: source.access_control,
    terms_status: source.terms_status,
    ...(source.robots_result !== undefined ? { robots_result: source.robots_result } : {}),
    ...(source.robots_path_decision !== undefined ? { robots_path_decision: source.robots_path_decision } : {}),
    ...(source.checked_path !== undefined ? { checked_path: source.checked_path } : {}),
    ...(source.retrieved_at !== undefined ? { retrieved_at: source.retrieved_at } : {}),
    ...(source.evidence !== undefined ? { evidence: source.evidence } : {}),
  }).allowed;
}

/** Recompute the canonical note hash from note bytes; caller-provided
 * note_hash is never trusted (it is overwritten). */
export function canonicalNoteHash(note: string): string {
  return `sha256:${sha256(note)}`;
}

/** Validate one discovery record against the schema; returns errors or null. */
export function validateDiscoveryRecord(record: unknown): string | null {
  const r = validateFile("discovery-record.schema.json", record);
  return r.valid ? null : r.errors ?? "invalid discovery record";
}

export function normalizeDiscovery(record: Record<string, unknown>): DiscoveryItem | null {
  const err = validateDiscoveryRecord(record);
  if (err) return null;
  // Recompute the canonical note hash; never trust the caller-supplied value.
  const note = String(record.note);
  const item: DiscoveryItem = {
    source_id: String(record.source_id),
    source_item_id: String(record.source_item_id),
    source_url: String(record.source_url),
    published_at: String(record.published_at),
    title: String(record.title),
    lang: record.lang as "ja" | "zh" | "en",
    note,
    note_hash: canonicalNoteHash(note),
  };
  // If the caller supplied a note_hash, it must match the recomputed value
  // (constant-time comparison to avoid timing side channels).
  if (record.note_hash !== undefined) {
    if (!timingSafeEqualStr(String(record.note_hash), item.note_hash)) {
      return null;
    }
  }
  return item;
}

/** Constant-time string equality (sha256 hex strings). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Identity key covers ONLY stable identity facts (source_id, source_item_id,
 * lang). content_hash/note changes are VERSIONS of the same identity, so a
 * changed draft becomes an explicit successor instead of a new identity or an
 * overwrite.
 */
export function identityKey(item: DiscoveryItem): string {
  return `${item.source_id}|${item.source_item_id}|${item.lang}`;
}

export function dedupKey(item: DiscoveryItem): string {
  return identityKey(item);
}

/** Derive the dedup state (identity key -> latest content_hash) from the
 * versioned draft files themselves. Only the HIGHEST version per identity is
 * authoritative; the files are the single source of truth, so a single atomic
 * file write is inherently a complete transaction. */
export function loadDedupManifest(): Record<string, string> {
  const manifest: Record<string, { hash: string; version: number }> = {};
  for (const item of loadDraftedItems()) {
    const ident = identityKey(item);
    const existing = manifest[ident];
    if (existing === undefined || item.version > existing.version) {
      manifest[ident] = { hash: contentHash(item), version: item.version };
    }
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(manifest)) out[k] = v.hash;
  return out;
}

/** Load the dedup manifest as a set of identity keys (compat helper). */
export function loadDedupKeys(): Set<string> {
  return new Set(Object.keys(loadDedupManifest()));
}

/** Resolve a staging-relative path and guarantee it stays inside DRAFT_ROOT.
 * Rejects traversal (../), absolute paths, symlink escapes, and a symlink/
 * non-directory staging ROOT itself. */
export function resolveStagedPath(relPath: string): string {
  const root = path.resolve(DRAFT_ROOT);
  if (fs.existsSync(root)) {
    const st = fs.lstatSync(root);
    if (st.isSymbolicLink()) throw new Error("staging root is a symlink");
    if (!st.isDirectory()) throw new Error("staging root is not a directory");
  }
  const candidate = path.resolve(root, relPath);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new Error("path escapes staging root");
  }
  // Reject symlink components (defense in depth).
  let cursor = root;
  for (const part of candidate.slice(root.length + 1).split(path.sep)) {
    if (!part) continue;
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error("path contains symlink component");
    }
  }
  return candidate;
}

/** Atomic write under a restricted staging root: temp file + fsync + rename,
 * never leaving a partial artifact at the target path. Temp names use a random
 * suffix and are cleaned on error; traversal is rejected. */
export function atomicWriteStaged(relPath: string, content: string): string {
  const out = resolveStagedPath(relPath);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  const tmp = path.join(DRAFT_ROOT, `.tmp-${path.basename(out)}-${process.pid}-${crypto.randomUUID().slice(0, 8)}`);
  let fd: number | undefined;
  try {
    fd = fs.openSync(tmp, "wx");
    fs.writeSync(fd, content, null, "utf8");
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, out);
  } catch (err) {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* ignore */ }
    }
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
  return out;
}

/** Frontmatter for a PR-ready draft content file (canonical index.md). */
export function draftFrontmatter(
  item: DiscoveryItem,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema_version: "1",
    kind: "news",
    source_id: item.source_id,
    source_item_id: item.source_item_id,
    source_url: item.source_url,
    published_at: item.published_at,
    title: item.title,
    lang: item.lang,
    note_hash: item.note_hash,
    content_hash: contentHash(item),
    review_status: "draft",
    reviewed_by: null,
    reviewed_at: null,
    risk_tier: "T1",
    ...extra,
  };
}

export interface DraftArtifact {
  path: string;
  frontmatter: Record<string, unknown>;
  body: string;
}

export function serializeDraft(artifact: DraftArtifact): string {
  const yamlText = yaml.dump(artifact.frontmatter, { sortKeys: true });
  return `---\n${yamlText}---\n${artifact.body}\n`;
}

export function writeDraft(artifact: DraftArtifact): string {
  return atomicWriteStaged(artifact.path, serializeDraft(artifact));
}

/** Draft path: identity dir with versioned filename so a changed draft becomes
 * an explicit successor (v1, v2, ...) instead of overwriting history. The year
 * is part of the directory layout but the version is scoped to the IDENTITY
 * across ALL years, so a same-identity item in a later year continues the
 * version sequence instead of forking. */
export function draftRelPath(item: DiscoveryItem, version = 1): string {
  const safeId = item.source_item_id.replace(/[^A-Za-z0-9._-]/g, "-");
  return path.join(
    "news",
    String(new Date(item.published_at).getUTCFullYear()),
    `${item.source_id}-${safeId}`,
    `index-v${version}.md`,
  );
}

/** Next version for an identity: scan ALL year dirs under the identity dir
 * name and return max version + 1 (monotonic across years). */
export function nextDraftVersion(item: DiscoveryItem): number {
  if (!fs.existsSync(DRAFT_ROOT)) return 1;
  const safeId = item.source_item_id.replace(/[^A-Za-z0-9._-]/g, "-");
  const identityName = `${item.source_id}-${safeId}`;
  const newsRoot = path.join(DRAFT_ROOT, "news");
  if (!fs.existsSync(newsRoot)) return 1;
  let max = 0;
  for (const year of fs.readdirSync(newsRoot)) {
    const dir = path.join(newsRoot, year, identityName);
    if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) continue;
    for (const f of fs.readdirSync(dir)) {
      const m = f.match(/^index-v(\d+)\.md$/);
      if (m) max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

/** Collect already-drafted items (for cross-source candidate detection).
 * Each item carries the parsed version number from its filename. */
export function loadDraftedItems(): Array<DiscoveryItem & { version: number }> {
  const items: Array<DiscoveryItem & { version: number }> = [];
  if (!fs.existsSync(DRAFT_ROOT)) return items;
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && /^index-v(\d+)\.md$/.test(entry.name)) {
        const version = Number(entry.name.match(/^index-v(\d+)\.md$/)![1]);
        const doc = matter(fs.readFileSync(full, "utf8"));
        const d = doc.data as Record<string, unknown>;
        if (!d.source_id || !d.source_item_id || !d.lang || !d.note_hash) continue;
        items.push({
          source_id: String(d.source_id),
          source_item_id: String(d.source_item_id),
          source_url: String(d.source_url ?? ""),
          published_at: String(d.published_at ?? ""),
          title: String(d.title ?? ""),
          lang: d.lang as "ja" | "zh" | "en",
          note: String(doc.content ?? "").replace(/\n$/, ""),
          note_hash: String(d.note_hash),
          version,
        });
      }
    }
  };
  walk(DRAFT_ROOT);
  return items;
}

/**
 * Cross-source semantic duplicates: an existing draft from a different
 * source_id carries the same normalized title. Reported as candidates,
 * never auto-swallowed.
 */
export function findCrossSourceCandidates(
  item: DiscoveryItem,
  existing: ReadonlyArray<DiscoveryItem>,
): string[] {
  const title = normalizeTitle(item.title);
  return existing
    .filter((e) => e.source_id !== item.source_id)
    .filter((e) => normalizeTitle(e.title) === title)
    .map((e) => `${e.source_id}|${e.source_item_id}|${e.lang}`);
}

export function normalizeTitle(title: string): string {
  return title.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Run cron for all configured sources: only allowed (automated_fetch=true +
 * path-bound robots decision) sources are fetched. With no allowed sources or
 * no change this is a silent no-op returning an empty summary.
 */
/** Check the discovery URL stays within the source's canonical HTTPS origin
 * AND the canonical path prefix with segment-boundary semantics
 * (canonical "/foo" does NOT allow "/foobar"). Off-origin is rejected. */
export function urlInScope(source: SourceConfig, url: string): boolean {
  const canon = source.canonical_url;
  if (!canon) return false;
  let src: URL;
  let item: URL;
  try {
    src = new URL(canon);
    item = new URL(url);
  } catch {
    return false;
  }
  if (src.protocol !== "https:" || item.protocol !== "https:") return false;
  // Reject embedded credentials (userinfo).
  if (item.username !== "" || item.password !== "") return false;
  // Compare full origin (host + port).
  if (item.origin !== src.origin) return false;
  const prefix = src.pathname.endsWith("/") ? src.pathname : `${src.pathname}/`;
  if (prefix === "/") return true;
  return item.pathname === prefix.slice(0, -1) || item.pathname.startsWith(prefix);
}

/** Plan + validate a discovery item for a source; returns the validated item
 * and target version, or a structured error. Never writes. */
export function planImport(
  item: DiscoveryItem,
  source: SourceConfig,
): { ok: true; version: number } | { ok: false; error: string } {
  if (item.source_id !== source.source_id) {
    return { ok: false, error: "item source_id does not match adapter source" };
  }
  if (!urlInScope(source, item.source_url)) {
    return { ok: false, error: "url_out_of_scope" };
  }
  const manifest = loadDedupManifest();
  const ident = identityKey(item);
  const prior = manifest[ident];
  const hash = contentHash(item);
  if (prior === hash) {
    return { ok: false, error: "unchanged duplicate" };
  }
  const version = prior === undefined ? 1 : nextDraftVersion(item);
  return { ok: true, version };
}

/** Build the next version for an identity while planning a batch. Tracks
 * planned versions AND hashes in-memory so two same-identity items in ONE
 * batch get distinct successor versions, and unchanged re-fetches are counted
 * as duplicates (not derived from pre-commit files). */
export function planVersionFor(
  item: DiscoveryItem,
  planned: Map<string, { version: number; hash: string }>,
): number {
  const ident = identityKey(item);
  const existing = planned.get(ident);
  if (existing !== undefined) {
    const next = existing.version + 1;
    planned.set(ident, { version: next, hash: contentHash(item) });
    return next;
  }
  const manifest = loadDedupManifest();
  const priorVersion = manifest[ident] !== undefined ? nextDraftVersion(item) : 1;
  planned.set(ident, { version: priorVersion, hash: contentHash(item) });
  return priorVersion;
}

/** Serialize a batch of planned artifacts into a fresh staging directory,
 * then atomically swap it in as DRAFT_ROOT (temp dir + rename). On any write
 * or commit failure the staging dir is removed and DRAFT_ROOT is untouched
 * (zero state change). Returns whether the batch committed and whether a
 * best-effort old-tree backup cleanup left residue (observable, honest). */
export function commitPlannedBatch(
  artifacts: Array<{ relPath: string; content: string }>,
): { committed: boolean; cleanupResidue: boolean } {
  const root = path.resolve(DRAFT_ROOT);
  // Reject a symlink/irregular root before doing anything.
  if (fs.existsSync(root)) {
    const st = fs.lstatSync(root);
    if (st.isSymbolicLink()) throw new Error("staging root is a symlink");
    if (!st.isDirectory()) throw new Error("staging root is not a directory");
  }
  const staging = path.join(path.dirname(root), `.drafts-staging-${process.pid}-${randomUUID().slice(0, 8)}`);
  try {
    // Copy existing drafts into staging so committed batch is a superset.
    if (fs.existsSync(root)) {
      fs.cpSync(root, staging, { recursive: true });
    } else {
      fs.mkdirSync(staging, { recursive: true });
    }
    for (const a of artifacts) {
      const out = resolveStagedPathRelative(staging, a.relPath);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmp = path.join(staging, `.tmp-${path.basename(out)}-${randomUUID().slice(0, 8)}`);
      let fd: number | undefined;
      try {
        fd = fs.openSync(tmp, "wx");
        fs.writeSync(fd, a.content, null, "utf8");
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fd = undefined;
        fs.renameSync(tmp, out);
      } finally {
        if (fd !== undefined) {
          try { fs.closeSync(fd); } catch { /* ignore */ }
        }
        try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
      }
    }
    // Swap atomically: move old root aside, move staging into place. The
    // swap is the commit point; once staging->root succeeds the batch is
    // committed and the old backup is best-effort cleanup (a cleanup failure
    // is reported as residue, never as a failed commit).
    const backup = path.join(path.dirname(root), `.drafts-old-${process.pid}-${randomUUID().slice(0, 8)}`);
    let movedOld = false;
    try {
      if (fs.existsSync(root)) {
        fs.renameSync(root, backup);
        movedOld = true;
      }
      fs.renameSync(staging, root);
    } catch (err) {
      // Commit point failed: restore the previous tree (zero state change).
      if (movedOld && fs.existsSync(backup) && !fs.existsSync(root)) {
        try { fs.renameSync(backup, root); } catch { /* ignore */ }
      }
      throw err;
    }
    // Committed. Best-effort backup cleanup; residue is reported honestly.
    let cleanupResidue = false;
    if (movedOld) {
      try {
        fs.rmSync(backup, { recursive: true, force: true });
      } catch {
        cleanupResidue = true; // backup left behind; observable via result
      }
    }
    return { committed: true, cleanupResidue };
  } catch (err) {
    try { fs.rmSync(staging, { recursive: true, force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/** Resolve a staging-relative path against a given root (used inside the
 * staging tree swap). Rejects traversal/absolute paths and symlink components. */
export function resolveStagedPathRelative(rootAbs: string, relPath: string): string {
  const candidate = path.resolve(rootAbs, relPath);
  const root = path.resolve(rootAbs);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new Error("path escapes staging root");
  }
  let cursor = root;
  for (const part of candidate.slice(root.length + 1).split(path.sep)) {
    if (!part) continue;
    cursor = path.join(cursor, part);
    if (fs.existsSync(cursor) && fs.lstatSync(cursor).isSymbolicLink()) {
      throw new Error("path contains symlink component");
    }
  }
  return candidate;
}

export async function runCron(sourcesPath?: string): Promise<{
  fetched: string[];
  produced: number;
  duplicates: number;
  errors: Record<string, string>;
}> {
  const sources = loadSources(sourcesPath);
  const fetched: string[] = [];
  let produced = 0;
  let duplicates = 0;
  const errors: Record<string, string> = {};
  const fetchTargets: Array<{
    source: SourceConfig;
    adapter: SourceAdapter;
    requestedPath: string;
    errorKey: string;
  }> = [];
  let preflightError = false;

  if (sources.every((source) => source.automated_fetch !== true)) {
    return { fetched: [], produced: 0, duplicates: 0, errors: {} };
  }

  for (const source of sources) {
    if (source.automated_fetch !== true) continue;
    const paths = source.fetch_paths;
    if (
      !Array.isArray(paths) ||
      paths.length === 0 ||
      new Set(paths).size !== paths.length ||
      !paths.every((requestedPath) => isFetchPath(requestedPath))
    ) {
      errors[source.source_id] = "fetch_paths_missing_or_invalid";
      preflightError = true;
      continue;
    }
    const adapter = sourceAdapterFor(source.source_id);
    if (!adapter) {
      errors[source.source_id] = "no_adapter_registered";
      preflightError = true;
      continue;
    }
    const deniedPaths = paths.filter((requestedPath) => !sourceAllowedToFetch(source, requestedPath));
    if (deniedPaths.length > 0) {
      for (const requestedPath of deniedPaths) {
        errors[source.source_id + ":" + requestedPath] = "fetch_target_not_allowed";
      }
      preflightError = true;
      continue;
    }
    for (const requestedPath of paths) {
      fetchTargets.push({
        source,
        adapter,
        requestedPath,
        errorKey: paths.length === 1 ? source.source_id : source.source_id + ":" + requestedPath,
      });
    }
  }

  if (fetchTargets.length === 0) {
    return { fetched: [], produced: 0, duplicates: 0, errors };
  }

  // Phase 1: fetch + validate ALL items, plan versions in-memory. NO writes.
  const planned = new Map<string, { version: number; hash: string }>();
  const artifacts: Array<{ relPath: string; content: string }> = [];
  let anyError = preflightError;
  for (const target of fetchTargets) {
    const { source, adapter, requestedPath, errorKey } = target;
    if (!fetched.includes(source.source_id)) fetched.push(source.source_id);
    let result: FetchResult | null | undefined;
    try {
      result = await adapter.fetch(source, requestedPath);
    } catch (err) {
      // adapter may throw null / a primitive / non-Error; fail closed.
      const msg = err instanceof Error ? err.message : `non-error thrown: ${String(err)}`;
      errors[errorKey] = `adapter_unexpected: ${msg}`;
      anyError = true;
      continue;
    }
    if (result === null || result === undefined || typeof result !== "object") {
      errors[errorKey] = "adapter_unexpected: fetch returned non-object";
      anyError = true;
      continue;
    }
    if (result.ok !== true) {
      errors[errorKey] = result.error ?? result.code ?? "fetch_failed";
      anyError = true;
      continue;
    }
    if (!Array.isArray(result.items)) {
      errors[errorKey] = "invalid_items_not_array";
      anyError = true;
      continue;
    }
    for (const rawItem of result.items) {
      if (rawItem === null || typeof rawItem !== "object") {
        errors[`${source.source_id}:(invalid-item)`] = "invalid_item";
        anyError = true;
        continue;
      }
      const item = normalizeDiscovery(rawItem as unknown as Record<string, unknown>);
      if (!item) {
        errors[`${source.source_id}:${(rawItem as { source_item_id?: string }).source_item_id ?? "?"}`] = "invalid_item";
        anyError = true;
        continue;
      }
      if (item.source_id !== source.source_id) {
        errors[`${source.source_id}:${item.source_item_id}`] = "source_id_mismatch";
        anyError = true;
        continue;
      }
      if (!urlInScope(source, item.source_url)) {
        errors[`${source.source_id}:${item.source_item_id}`] = "url_out_of_scope";
        anyError = true;
        continue;
      }
      // Unchanged duplicate (same identity + same content already committed or
      // already planned in this batch).
      const ident = identityKey(item);
      const plannedEntry = planned.get(ident);
      const manifest = loadDedupManifest();
      if (plannedEntry !== undefined) {
        if (plannedEntry.hash === contentHash(item)) {
          duplicates += 1;
          continue;
        }
      } else if (manifest[ident] === contentHash(item)) {
        duplicates += 1;
        continue;
      }
      const version = planVersionFor(item, planned);
      artifacts.push({
        relPath: draftRelPath(item, version),
        content: serializeDraft({ path: draftRelPath(item, version), frontmatter: draftFrontmatter(item), body: item.note }),
      });
      produced += 1;
    }
  }

  // If any fetch/validation/format error occurred, the whole batch is NOT
  // committed (no partial artifacts). Duplicates counted only when clean.
  if (anyError) {
    return { fetched, produced: 0, duplicates: 0, errors };
  }

  // Phase 2: single staging-tree commit (atomic swap). No writes before this.
  // Any commit failure is a structured error with NO state change.
  if (artifacts.length > 0) {
    try {
      const res = commitPlannedBatch(artifacts);
      if (res.cleanupResidue) {
        errors["commit"] = "commit_ok_with_cleanup_residue";
      }
    } catch (err) {
      errors["commit"] = `commit_failed: ${(err as Error).message}`;
      return { fetched, produced: 0, duplicates: 0, errors };
    }
  }
  return { fetched, produced, duplicates, errors };
}

/** Manual-import one discovery record; returns a structured result.
 * The source must be present in the loaded config (no caller-injected source),
 * and the item is validated/planned before a single atomic write. */
export function importDiscovery(
  record: Record<string, unknown>,
  opts: { sourcesPath?: string } = {},
): {
  status: "accepted" | "duplicate" | "changed" | "invalid" | "rejected" | "error";
  path?: string;
  version?: number;
  error?: string;
  code?: string;
  candidates?: string[];
} {
  const item = normalizeDiscovery(record);
  if (!item) {
    return { status: "invalid", error: "invalid discovery record (schema)" };
  }
  // Source must be a registered source in the loaded config.
  const sources = loadSources(opts.sourcesPath);
  const source = sources.find((s) => s.source_id === item.source_id);
  if (!source) {
    return { status: "rejected", error: `unknown source: ${item.source_id}` };
  }
  const p = planImport(item, source);
  if (!p.ok) {
    if (p.error === "unchanged duplicate") {
      return { status: "duplicate", error: "unchanged duplicate (same identity + content)" };
    }
    return { status: "rejected", error: p.error };
  }
  const candidates = findCrossSourceCandidates(item, loadDraftedItems());
  const relPath = draftRelPath(item, p.version);
  const targetDir = path.dirname(path.join(DRAFT_ROOT, relPath));
  try {
    const written = writeDraft({ path: relPath, frontmatter: draftFrontmatter(item), body: item.note });
    return { status: p.version === 1 ? "accepted" : "changed", path: written, version: p.version, candidates };
  } catch (err) {
    // Structured failure with zero state change: remove the target dir and
    // any empty parent dirs this attempt created, so no partial artifact
    // (or empty skeleton) remains under DRAFT_ROOT.
    pruneEmptyParents(targetDir);
    return { status: "error", error: `write_failed: ${(err as Error).message}`, code: "write_failed" };
  }
}

/** Remove empty directories from `dir` upward to DRAFT_ROOT (best-effort).
 * Also removes DRAFT_ROOT itself if it becomes empty. */
export function pruneEmptyParents(dir: string): void {
  const root = path.resolve(DRAFT_ROOT);
  let cur = path.resolve(dir);
  try {
    while (cur.startsWith(root) && cur !== path.dirname(root)) {
      try {
        fs.rmdirSync(cur);
      } catch {
        break; // not empty or failed; stop
      }
      if (cur === root) break;
      cur = path.dirname(cur);
    }
  } catch {
    /* ignore */
  }
}
