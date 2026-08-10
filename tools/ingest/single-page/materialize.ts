/**
 * Generic official-single-page materializer (task #31 redesign, serika).
 *
 * Fully offline. A declarative, schema-validated source profile defines the
 * fixed URL/origin, strict selector/type contract, and limits/redirect policy.
 * Each item is an auditable structured data file carrying allowlisted
 * extracted fields, a human fact note, and locale drafts produced externally
 * (LLM/agent). This module only validates, normalizes, dedups, and writes the
 * draft bundle through the editorial seam. It performs no network, no model
 * calls, no eval, no recursive key search, and no "similar field" fallback.
 *
 * New content adds only data (a profile entry + item JSON) and a final content
 * bundle — never new TS/JS.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { materializeDiscovery } from "../../editorial/editorial.ts";
import { normalizeDiscovery } from "../ingest.ts";
import { validateFile } from "../../schema/validate.ts";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../../..", import.meta.url)));
export const PROFILES_PATH = path.join(REPO_ROOT, "config", "single-page-profiles.json");
export const ITEMS_DIR = path.join(REPO_ROOT, "tools", "ingest", "single-page", "items");

export interface SinglePageLimits {
  max_bytes: number;
  deadline_ms: number;
  max_redirects: number;
  allowed_content_types: string[];
}

export interface SinglePageField {
  type: "string";
  map_to?: "source_item_id" | "source_url" | "title" | "lang" | "published_at";
  const?: string;
  min_length?: number;
  value_format?: "dspdate_iso_jst";
}

export interface SinglePageProfile {
  schema_version: "1";
  source_id: string;
  canonical_url: string;
  origin: string;
  automated_fetch: false;
  limits: SinglePageLimits;
  selector: {
    root_path: string[];
    fields: Record<string, SinglePageField>;
  };
}

export interface SinglePageLocaleDraft {
  lang: "zh" | "en";
  body: string;
  reason?: string;
}

export interface SinglePageItem {
  schema_version: "1";
  source_id: string;
  page_url: string;
  source_lang: "ja" | "zh" | "en";
  extracted: Record<string, string>;
  fact_note: string;
  locale_drafts: SinglePageLocaleDraft[];
  provenance: { fetched_at: string; http_status: 200; bytes: number; content_type: string };
  model: { model_version: string };
}

export type SinglePageCode =
  | "profile_not_found"
  | "profile_invalid"
  | "item_invalid"
  | "item_source_mismatch"
  | "url_not_exact_page"
  | "field_missing"
  | "field_type_invalid"
  | "field_const_mismatch"
  | "field_too_short"
  | "field_format_invalid"
  | "map_to_invalid"
  | "discovery_invalid";

export class SinglePageError extends Error {
  readonly code: SinglePageCode;

  constructor(code: SinglePageCode, message: string) {
    super(message);
    this.name = "SinglePageError";
    this.code = code;
  }
}

/** Load all source profiles; returns the profile for source_id or null. */
export function loadProfiles(profilesPath = PROFILES_PATH): SinglePageProfile[] {
  const raw = JSON.parse(fs.readFileSync(profilesPath, "utf8"));
  const entries = (raw as { profiles?: unknown[] }).profiles ?? [];
  if (!Array.isArray(entries)) throw new SinglePageError("profile_invalid", "profiles file must contain a profiles array");
  return entries.map((entry) => {
    const checked = validateFile("single-page-profile.schema.json", entry);
    if (!checked.valid) throw new SinglePageError("profile_invalid", `profile failed schema: ${checked.errors ?? "invalid"}`);
    return entry as SinglePageProfile;
  });
}

export function loadProfile(sourceId: string, profilesPath = PROFILES_PATH): SinglePageProfile | null {
  return loadProfiles(profilesPath).find((p) => p.source_id === sourceId) ?? null;
}

/** Load and schema-validate one item data file. */
export function loadItem(itemPath: string): SinglePageItem {
  const raw = JSON.parse(fs.readFileSync(itemPath, "utf8"));
  const checked = validateFile("single-page-item.schema.json", raw);
  if (!checked.valid) throw new SinglePageError("item_invalid", `item failed schema: ${checked.errors ?? "invalid"}`);
  return raw as SinglePageItem;
}

function expectField(item: SinglePageItem, key: string): string {
  const value = item.extracted[key];
  if (value === undefined) throw new SinglePageError("field_missing", `extracted field missing: ${key}`);
  if (typeof value !== "string") throw new SinglePageError("field_type_invalid", `extracted field is not a string: ${key}`);
  return value;
}

/** Convert dspdate "YYYY/MM/DD HH:mm" to an ISO 8601 instant (JST, +09:00). */
export function dspdateToIsoJst(value: string): string {
  const m = value.trim().match(/^(\d{4})\/(\d{2})\/(\d{2}) (\d{2}):(\d{2})$/);
  if (!m) throw new SinglePageError("field_format_invalid", `dspdate does not match YYYY/MM/DD HH:mm: ${value}`);
  const [, y, mo, d, h, mi] = m;
  return `${y}-${mo}-${d}T${h}:${mi}:00+09:00`;
}

/**
 * Validate every selector field strictly (fixed path + type + value contract).
 * No recursive search, no similar-field fallback. Returns a map of map_to →
 * value for the discovery record.
 */
export function validateExtracted(profile: SinglePageProfile, item: SinglePageItem): Record<string, string> {
  if (item.source_id !== profile.source_id) {
    throw new SinglePageError("item_source_mismatch", `item source_id ${item.source_id} does not match profile ${profile.source_id}`);
  }
  if (item.page_url !== profile.canonical_url) {
    throw new SinglePageError("url_not_exact_page", `item page_url must equal the frozen canonical page: ${profile.canonical_url}`);
  }
  const mapped: Record<string, string> = {};
  for (const [key, field] of Object.entries(profile.selector.fields)) {
    const value = expectField(item, key);
    if (field.const !== undefined && value !== field.const) {
      throw new SinglePageError("field_const_mismatch", `${key} must equal ${field.const}, got ${value}`);
    }
    if (field.min_length !== undefined && value.length < field.min_length) {
      throw new SinglePageError("field_too_short", `${key} shorter than min_length ${field.min_length}`);
    }
    if (field.map_to === undefined) continue;
    let out = value;
    if (field.value_format === "dspdate_iso_jst") {
      out = dspdateToIsoJst(value);
    }
    mapped[field.map_to] = out;
  }
  return mapped;
}

/**
 * Build the canonical discovery record for an item: source facts from the
 * allowlisted extracted fields, canonical body from the frozen human fact note
 * (source language). No raw HTML/body/media ever enters the record.
 */
export function buildDiscoveryRecord(
  mapped: Record<string, string>,
  item: SinglePageItem,
): Record<string, unknown> {
  const sourceItemId = mapped.source_item_id;
  const sourceUrl = mapped.source_url;
  const title = mapped.title;
  const publishedAt = mapped.published_at;
  const lang = mapped.lang ?? item.source_lang;
  if (!sourceItemId || !sourceUrl || !title || !publishedAt) {
    throw new SinglePageError("map_to_invalid", "selector did not produce required source facts");
  }
  if (lang !== item.source_lang) {
    throw new SinglePageError("map_to_invalid", "selector lang does not match declared source_lang");
  }
  return {
    schema_version: "1",
    source_id: item.source_id,
    source_item_id: sourceItemId,
    source_url: sourceUrl,
    published_at: publishedAt,
    title,
    lang,
    note: item.fact_note,
  };
}

/**
 * Materialize one item through the editorial seam into a content bundle.
 * Offline: validates profile+item, normalizes, dedups, writes drafts.
 * Re-running with the same inputs is a whole-tree zero-diff no-op.
 */
export function materializeSinglePage(
  sourceId: string,
  item: SinglePageItem,
  root = REPO_ROOT,
  profilesPath = PROFILES_PATH,
): { ok: boolean; changed: boolean; contentPath?: string; error?: string } {
  let profile: SinglePageProfile | null;
  let mapped: Record<string, string>;
  try {
    profile = loadProfile(sourceId, profilesPath);
    if (!profile) return { ok: false, changed: false, error: `profile not found: ${sourceId}` };
    mapped = validateExtracted(profile, item);
  } catch (err) {
    return { ok: false, changed: false, error: err instanceof Error ? err.message : String(err) };
  }
  let record: Record<string, unknown>;
  let discovery;
  try {
    record = buildDiscoveryRecord(mapped, item);
    discovery = normalizeDiscovery(record);
  } catch (err) {
    return { ok: false, changed: false, error: err instanceof Error ? err.message : String(err) };
  }
  if (!discovery) {
    return { ok: false, changed: false, error: "built discovery record failed schema validation" };
  }
  const result = materializeDiscovery(discovery, {
    root,
    at: item.provenance.fetched_at,
    actor: "serika-ai-draft",
    actor_kind: "ai",
    reason: "official-single-page human-directed sample",
    risk_tier: "T1",
    translation_drafts: item.locale_drafts.map((d) => ({
      lang: d.lang,
      body: d.body,
      actor: "serika-ai-draft",
      actor_kind: "ai" as const,
      model_version: item.model.model_version,
      reason: d.reason ?? "AI draft translation",
    })),
  });
  if (!result.ok) {
    return { ok: false, changed: false, error: result.error.message };
  }
  return { ok: true, changed: result.changed, contentPath: result.value.content_path };
}

/** Resolve an item path by source_id + item id within the canonical items dir. */
export function itemPathFor(sourceId: string, sourceItemId: string): string {
  return path.join(ITEMS_DIR, `${sourceId}-${sourceItemId}.json`);
}

export function loadItemFor(sourceId: string, sourceItemId: string): SinglePageItem {
  return loadItem(itemPathFor(sourceId, sourceItemId));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  // CLI: node --experimental-strip-types tools/ingest/single-page/materialize.ts <item-path> [--root <dir>]
  const args = process.argv.slice(2);
  const itemArg = args.find((a) => !a.startsWith("--"));
  const rootArgIndex = args.indexOf("--root");
  const root = rootArgIndex >= 0 ? args[rootArgIndex + 1] : REPO_ROOT;
  if (!itemArg) {
    console.error("usage: materialize.ts <item.json> [--root <dir>]");
    process.exit(2);
  }
  const item = loadItem(itemArg);
  const result = materializeSinglePage(item.source_id, item, path.resolve(root ?? REPO_ROOT));
  if (!result.ok) {
    console.error(`materialize failed: ${result.error}`);
    process.exit(1);
  }
  console.log(
    result.changed
      ? `materialized ${item.source_id} -> ${result.contentPath}`
      : `unchanged (zero-diff no-op) ${item.source_id} -> ${result.contentPath}`,
  );
}
