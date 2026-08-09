/**
 * momoko.pro Phase 2B ingestion seam (task #7, 翼（tsubasa）).
 *
 * Unified terms-gated source adapters, normalized discovery records,
 * content fingerprint/dedup, silent no-change runs, and PR-ready synthetic
 * drafts. External pages are treated as untrusted input: adapters only carry
 * human fact-notes / approved excerpts — never auto-summarized body text.
 *
 * Contract (design §5.2/§5.3, momoko automation ceiling):
 * - cron only runs adapters for sources with `automated_fetch=true` AND
 *   explicit robots/terms approval evidence; S1–S5 all false => silent no-op.
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
  /** Fetch discovery items for one source. Never executes untrusted URL payloads. */
  fetch(source: Record<string, unknown>): Promise<FetchResult>;
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
  robots_http?: string | number | null;
  robots_note?: string;
  terms_note?: string;
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

/**
 * A source is only "allowed to fetch" when BOTH robots and terms were
 * explicitly approved (allowed=true) with recorded evidence. automated_fetch
 * alone or a 2xx robots_http is NOT approval; missing/negative evidence is
 * never treated as allowance.
 */
export function sourceAllowedToFetch(source: SourceConfig): boolean {
  if (source.automated_fetch !== true) return false;
  const robots = source.robots_approved;
  const terms = source.terms_approved;
  if (!robots || robots.allowed !== true || !robots.evidence) return false;
  if (!terms || terms.allowed !== true || !terms.evidence) return false;
  return true;
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
 * verified robots/terms) sources are fetched. With no allowed sources or no
 * change this is a silent no-op returning an empty summary.
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
 * failure the staging dir is removed and DRAFT_ROOT is untouched. */
export function commitPlannedBatch(
  artifacts: Array<{ relPath: string; content: string }>,
): void {
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
    // Swap atomically: move old root aside, move staging into place, and on
    // failure restore the old tree so DRAFT_ROOT is never lost or partial.
    const backup = path.join(path.dirname(root), `.drafts-old-${process.pid}-${randomUUID().slice(0, 8)}`);
    let movedOld = false;
    try {
      if (fs.existsSync(root)) {
        fs.renameSync(root, backup);
        movedOld = true;
      }
      fs.renameSync(staging, root);
      if (movedOld) {
        fs.rmSync(backup, { recursive: true, force: true });
      }
    } catch (err) {
      // Restore the previous tree if we moved it away.
      if (movedOld && fs.existsSync(backup) && !fs.existsSync(root)) {
        try { fs.renameSync(backup, root); } catch { /* ignore */ }
      }
      throw err;
    }
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
  const allowed = sources.filter(sourceAllowedToFetch);
  const fetched: string[] = [];
  let produced = 0;
  let duplicates = 0;
  const errors: Record<string, string> = {};

  if (allowed.length === 0) {
    return { fetched: [], produced: 0, duplicates: 0, errors: {} };
  }

  // Phase 1: fetch + validate ALL items, plan versions in-memory. NO writes.
  const planned = new Map<string, { version: number; hash: string }>();
  const artifacts: Array<{ relPath: string; content: string }> = [];
  let anyError = false;
  for (const source of allowed) {
    const adapter = sourceAdapterFor(source.source_id);
    if (!adapter) {
      errors[source.source_id] = "no_adapter_registered";
      anyError = true;
      continue;
    }
    fetched.push(source.source_id);
    let result: FetchResult;
    try {
      result = await adapter.fetch(source);
    } catch (err) {
      errors[source.source_id] = `unexpected: ${(err as Error).message}`;
      anyError = true;
      continue;
    }
    if (!result.ok) {
      errors[source.source_id] = result.error ?? result.code ?? "fetch_failed";
      anyError = true;
      continue;
    }
    if (!Array.isArray(result.items)) {
      errors[source.source_id] = "invalid_items_not_array";
      anyError = true;
      continue;
    }
    for (const rawItem of result.items) {
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
      commitPlannedBatch(artifacts);
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
  status: "accepted" | "duplicate" | "changed" | "invalid" | "rejected";
  path?: string;
  version?: number;
  error?: string;
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
  const written = writeDraft({ path: draftRelPath(item, p.version), frontmatter: draftFrontmatter(item), body: item.note });
  return { status: p.version === 1 ? "accepted" : "changed", path: written, version: p.version, candidates };
}
