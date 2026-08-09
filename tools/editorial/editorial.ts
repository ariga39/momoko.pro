/**
 * Phase 2C editorial lifecycle.
 *
 * This module deliberately has no network, model, GitHub, or deployment
 * capability.  It consumes a normalized discovery item from the Phase 2B
 * seam and produces the existing content/locale schema files plus one
 * append-only editorial history sidecar.  `published` is a build projection,
 * never a mutable canonical status.
 */

import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

import matter from "gray-matter";
import yaml from "js-yaml";

import {
  contentHash,
  type DiscoveryItem,
} from "../ingest/ingest.ts";

export const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
export const EDITORIAL_HISTORY_VERSION = "1" as const;
export const EDITORIAL_LOCALES = ["ja", "zh", "en"] as const;

export type EditorialLocale = (typeof EDITORIAL_LOCALES)[number];
export type TranslationLocale = Exclude<EditorialLocale, "ja">;
export type CanonicalStatus = "draft" | "reviewed" | "stale" | "retracted";
export type DerivedStatus = CanonicalStatus | "published";
export type ActorKind = "human" | "ai" | "system";
export type HistoryScope = "canonical" | "locale";

export type EditorialErrorCode =
  | "invalid_input"
  | "unsupported_source_locale"
  | "identity_conflict"
  | "source_hash_drift"
  | "translation_hash_drift"
  | "token_invalid"
  | "ai_review_forbidden"
  | "sensitive_content_requires_human"
  | "illegal_transition"
  | "already_retracted"
  | "history_invalid"
  | "write_failed";

export interface EditorialError {
  code: EditorialErrorCode;
  message: string;
  details?: Record<string, string>;
}

export type EditorialResult<T> =
  | { ok: true; value: T; changed: boolean }
  | { ok: false; error: EditorialError };

export interface CanonicalContentRecord {
  schema_version: "1";
  kind: "news";
  source_id: string;
  source_item_id: string;
  published_at: string;
  content_hash: string;
  risk_tier: "T0" | "T1" | "T2";
  ai_generated: boolean;
  model_version: string | null;
  lang: "ja";
  title: string;
  source_url: string;
  original_title: null;
  review_status: CanonicalStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  body: string;
}

export interface LocaleContentRecord {
  schema_version: "1";
  content_path: string;
  lang: TranslationLocale;
  source_content_hash: string;
  content_hash: string;
  review_status: CanonicalStatus;
  reviewed_by: string | null;
  reviewed_at: string | null;
  body: string;
}

export interface HistoryEvent {
  sequence: number;
  event_id: string;
  operation_id: string;
  scope: HistoryScope;
  lang: EditorialLocale | null;
  from: DerivedStatus | null;
  to: DerivedStatus;
  actor: string;
  actor_kind: ActorKind;
  at: string;
  reason: string;
  source_content_hash: string;
  content_hash: string | null;
  model_version?: string | null;
}

export interface EditorialHistory {
  history_version: typeof EDITORIAL_HISTORY_VERSION;
  identity: string;
  events: HistoryEvent[];
}

export interface RetractionRecord {
  schema_version: "1";
  id: string;
  content_path: string;
  status: "active";
  reason: string;
  requested_at: string;
  requested_by: string;
}

export interface EditorialBundle {
  identity: string;
  content_path: string;
  canonical: CanonicalContentRecord;
  locales: Partial<Record<TranslationLocale, LocaleContentRecord>>;
  history: EditorialHistory;
  retraction?: RetractionRecord;
}

export interface TranslationDraftInput {
  lang: TranslationLocale;
  body: string;
  actor: string;
  actor_kind: ActorKind;
  at?: string;
  model_version?: string | null;
  reason?: string;
}

export interface DraftOptions {
  actor?: string;
  actor_kind?: ActorKind;
  at?: string;
  reason?: string;
  risk_tier?: "T0" | "T1" | "T2";
  translation_drafts?: TranslationDraftInput[];
}

export interface ReviewToken {
  token_version: "1";
  token_hash: string;
  identity: string;
  scope: HistoryScope;
  lang: EditorialLocale | null;
  source_content_hash: string;
  content_hash: string;
  issued_for: string;
  issued_by: string;
  issued_at: string;
}

export interface ReviewRequest {
  token: ReviewToken;
  actor: string;
  actor_kind: ActorKind;
  at: string;
  reason: string;
  operation_id: string;
}

export interface SourceUpdateRequest {
  actor?: string;
  actor_kind?: ActorKind;
  at: string;
  reason: string;
  operation_id: string;
}

export interface RetractionRequest {
  actor: string;
  actor_kind: ActorKind;
  at: string;
  reason: string;
  operation_id: string;
}

export interface PublicationLocale {
  status: DerivedStatus;
  indexable: boolean;
  source_content_hash: string;
  content_hash: string;
}

export interface PublicationProjection {
  identity: string;
  status: DerivedStatus;
  indexable: boolean;
  canonical: {
    status: DerivedStatus;
    indexable: boolean;
    content_hash: string;
  };
  locales: Record<TranslationLocale, PublicationLocale>;
}

function error(
  code: EditorialErrorCode,
  message: string,
  details?: Record<string, string>,
): { ok: false; error: EditorialError } {
  return { ok: false, error: { code, message, ...(details ? { details } : {}) } };
}

function ok<T>(value: T, changed = true): EditorialResult<T> {
  return { ok: true, value, changed };
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function prefixedHash(value: string): string {
  return `sha256:${value}`;
}

function safeItemId(sourceItemId: string): string {
  const safe = sourceItemId.replace(/[^A-Za-z0-9._-]/g, "-");
  return safe || "item";
}

export function editorialIdentity(item: Pick<DiscoveryItem, "source_id" | "source_item_id">): string {
  return `${item.source_id}|${item.source_item_id}`;
}

export function editorialContentHash(item: DiscoveryItem): string {
  return prefixedHash(contentHash(item));
}

export function translationContentHash(
  sourceContentHash: string,
  lang: TranslationLocale,
  body: string,
): string {
  return prefixedHash(sha256(JSON.stringify({ lang, source_content_hash: sourceContentHash, body })));
}

function contentRelativePath(item: Pick<DiscoveryItem, "source_id" | "source_item_id" | "published_at">): string {
  const year = new Date(item.published_at).getUTCFullYear();
  if (!Number.isInteger(year) || year < 1970 || year > 9999) {
    throw new Error("invalid published_at year");
  }
  return path.posix.join("content", "news", String(year), `${item.source_id}-${safeItemId(item.source_item_id)}`);
}

function historyEvent(
  bundle: EditorialBundle,
  input: Omit<HistoryEvent, "sequence" | "event_id">,
): HistoryEvent {
  return {
    ...input,
    sequence: bundle.history.events.length + 1,
    event_id: randomUUID(),
  };
}

function appendEvent(
  bundle: EditorialBundle,
  input: Omit<HistoryEvent, "sequence" | "event_id">,
): EditorialBundle {
  return {
    ...bundle,
    history: {
      ...bundle.history,
      events: [...bundle.history.events, historyEvent(bundle, input)],
    },
  };
}

function findOperation(bundle: EditorialBundle, operationId: string): HistoryEvent | undefined {
  return bundle.history.events.find((event) => event.operation_id === operationId);
}

function sameOperationReplay(bundle: EditorialBundle, operationId: string, to: DerivedStatus): EditorialResult<EditorialBundle> | null {
  const prior = findOperation(bundle, operationId);
  if (!prior) return null;
  if (prior.to === to) return ok(bundle, false);
  return error("identity_conflict", "operation_id was already used for a different state transition", {
    operation_id: operationId,
    prior_status: prior.to,
    requested_status: to,
  });
}

function validateHistory(bundle: EditorialBundle): EditorialError | null {
  if (bundle.history.history_version !== EDITORIAL_HISTORY_VERSION) {
    return { code: "history_invalid", message: "unsupported editorial history version" };
  }
  if (bundle.history.identity !== bundle.identity) {
    return { code: "history_invalid", message: "history identity does not match content identity" };
  }
  let expected = 1;
  const operationIds = new Set<string>();
  for (const event of bundle.history.events) {
    if (event.sequence !== expected++) {
      return { code: "history_invalid", message: "editorial history sequence is not append-only" };
    }
    if (!event.operation_id || operationIds.has(event.operation_id)) {
      return { code: "history_invalid", message: "editorial history has duplicate operation_id" };
    }
    operationIds.add(event.operation_id);
    if (!event.actor || !event.at || !event.reason || !event.source_content_hash) {
      return { code: "history_invalid", message: "editorial history event lacks audit fields" };
    }
  }
  const latest = new Map<string, DerivedStatus>();
  for (const event of bundle.history.events) {
    latest.set(`${event.scope}:${event.lang ?? ""}`, event.to);
  }
  if (latest.get("canonical:ja") !== bundle.canonical.review_status) {
    return { code: "history_invalid", message: "canonical status is not represented by the latest history event" };
  }
  for (const lang of ["zh", "en"] as const) {
    const locale = bundle.locales[lang];
    if (locale && latest.get(`locale:${lang}`) !== locale.review_status) {
      return { code: "history_invalid", message: `${lang} status is not represented by the latest history event` };
    }
  }
  return null;
}

function ensureCurrent(bundle: EditorialBundle): EditorialError | null {
  return validateHistory(bundle);
}

function emptyLocale(
  contentPath: string,
  sourceContentHash: string,
  lang: TranslationLocale,
  body = "",
): LocaleContentRecord {
  return {
    schema_version: "1",
    content_path: `${contentPath}/index.md`,
    lang,
    source_content_hash: sourceContentHash,
    content_hash: translationContentHash(sourceContentHash, lang, body),
    review_status: "draft",
    reviewed_by: null,
    reviewed_at: null,
    body,
  };
}

/** Convert a normalized Phase 2B discovery item into canonical + translation drafts. */
export function createDraftFromDiscovery(
  item: DiscoveryItem,
  options: DraftOptions = {},
): EditorialResult<EditorialBundle> {
  if (item.lang !== "ja") {
    return error("unsupported_source_locale", "canonical editorial content must be Japanese", {
      lang: item.lang,
    });
  }
  if (!item.note.trim() || !item.title.trim() || !item.source_item_id.trim()) {
    return error("invalid_input", "normalized discovery item lacks required content fields");
  }
  let contentPath: string;
  try {
    contentPath = contentRelativePath(item);
  } catch (err) {
    return error("invalid_input", `invalid discovery date: ${(err as Error).message}`);
  }
  const sourceHash = editorialContentHash(item);
  const actor = options.actor ?? "editorial-system";
  const actorKind = options.actor_kind ?? "system";
  const at = options.at ?? "2026-01-01T00:00:00Z";
  const identity = editorialIdentity(item);
  const canonical: CanonicalContentRecord = {
    schema_version: "1",
    kind: "news",
    source_id: item.source_id,
    source_item_id: item.source_item_id,
    published_at: item.published_at,
    content_hash: sourceHash,
    risk_tier: options.risk_tier ?? "T1",
    ai_generated: false,
    model_version: null,
    lang: "ja",
    title: item.title,
    source_url: item.source_url,
    original_title: null,
    review_status: "draft",
    reviewed_by: null,
    reviewed_at: null,
    body: item.note,
  };
  const bundle: EditorialBundle = {
    identity,
    content_path: contentPath,
    canonical,
    locales: {},
    history: {
      history_version: EDITORIAL_HISTORY_VERSION,
      identity,
      events: [],
    },
  };
  let next = appendEvent(bundle, {
    operation_id: `draft:${sourceHash}`,
    scope: "canonical",
    lang: "ja",
    from: null,
    to: "draft",
    actor,
    actor_kind: actorKind,
    at,
    reason: options.reason ?? "normalized discovery draft",
    source_content_hash: sourceHash,
    content_hash: sourceHash,
  });
  for (const lang of ["zh", "en"] as const) {
    const draft = options.translation_drafts?.find((candidate) => candidate.lang === lang);
    const locale = emptyLocale(contentPath, sourceHash, lang, draft?.body ?? "");
    next = {
      ...next,
      locales: { ...next.locales, [lang]: locale },
    };
    next = appendEvent(next, {
      operation_id: `draft:${sourceHash}:${lang}`,
      scope: "locale",
      lang,
      from: null,
      to: "draft",
      actor: draft?.actor ?? actor,
      actor_kind: draft?.actor_kind ?? actorKind,
      at,
      reason: draft?.reason ?? "translation draft; human review required",
      source_content_hash: sourceHash,
      content_hash: locale.content_hash,
      model_version: draft?.model_version ?? null,
    });
  }
  return ok(next);
}

/** Add or replace a translation draft only while the source revision is current. */
export function addTranslationDraft(
  bundle: EditorialBundle,
  input: TranslationDraftInput,
): EditorialResult<EditorialBundle> {
  const invalid = ensureCurrent(bundle);
  if (invalid) return { ok: false, error: invalid };
  if (!input.body.trim()) {
    return error("invalid_input", "translation draft body must be non-empty");
  }
  if (bundle.canonical.review_status === "retracted") {
    return error("already_retracted", "retracted content cannot receive new translation drafts");
  }
  const prior = bundle.locales[input.lang];
  if (prior && prior.source_content_hash === bundle.canonical.content_hash && prior.body === input.body) {
    return ok(bundle, false);
  }
  if (prior?.review_status === "reviewed" && prior.source_content_hash === bundle.canonical.content_hash) {
    return error("identity_conflict", "a current reviewed translation cannot be overwritten without a new source revision");
  }
  const locale = emptyLocale(bundle.content_path, bundle.canonical.content_hash, input.lang, input.body);
  const operationId = `translation-draft:${bundle.canonical.content_hash}:${input.lang}:${locale.content_hash}`;
  const replay = sameOperationReplay(bundle, operationId, "draft");
  if (replay) return replay;
  const from = prior?.review_status ?? null;
  let next: EditorialBundle = {
    ...bundle,
    locales: { ...bundle.locales, [input.lang]: locale },
  };
  next = appendEvent(next, {
    operation_id: operationId,
    scope: "locale",
    lang: input.lang,
    from,
    to: "draft",
    actor: input.actor,
    actor_kind: input.actor_kind,
    at: input.at ?? bundle.history.events.at(-1)?.at ?? "2026-01-01T00:00:00Z",
    reason: input.reason ?? "translation draft",
    source_content_hash: bundle.canonical.content_hash,
    content_hash: locale.content_hash,
    model_version: input.model_version ?? null,
  });
  return ok(next);
}

function tokenPayload(token: Omit<ReviewToken, "token_hash">): string {
  return JSON.stringify([
    token.token_version,
    token.identity,
    token.scope,
    token.lang,
    token.source_content_hash,
    token.content_hash,
    token.issued_for,
    token.issued_by,
    token.issued_at,
  ]);
}

/** Issue a version-bound human review token. AI actors cannot mint review tokens. */
export function issueReviewToken(
  bundle: EditorialBundle,
  input: { scope: HistoryScope; lang?: EditorialLocale | null; actor: string; actor_kind: ActorKind; at: string },
): EditorialResult<ReviewToken> {
  const invalid = ensureCurrent(bundle);
  if (invalid) return { ok: false, error: invalid };
  if (input.actor_kind !== "human") {
    return error("ai_review_forbidden", "only a human actor can issue a review token");
  }
  const lang = input.scope === "canonical" ? "ja" : input.lang;
  if (input.scope === "locale" && (lang !== "zh" && lang !== "en")) {
    return error("invalid_input", "locale review token requires zh or en");
  }
  const contentHash = input.scope === "canonical"
    ? bundle.canonical.content_hash
    : bundle.locales[lang as TranslationLocale]?.content_hash;
  if (!contentHash) return error("invalid_input", "cannot issue a token for a missing locale draft");
  const tokenBase: Omit<ReviewToken, "token_hash"> = {
    token_version: "1",
    identity: bundle.identity,
    scope: input.scope,
    lang: lang ?? null,
    source_content_hash: bundle.canonical.content_hash,
    content_hash: contentHash,
    issued_for: "human-review",
    issued_by: input.actor,
    issued_at: input.at,
  };
  return ok({ ...tokenBase, token_hash: prefixedHash(sha256(tokenPayload(tokenBase))) });
}

function validateReviewToken(bundle: EditorialBundle, request: ReviewRequest): EditorialError | null {
  const token = request.token;
  if (request.actor_kind !== "human") {
    return { code: "ai_review_forbidden", message: "only a human actor may confirm editorial review" };
  }
  if (token.issued_for !== "human-review" || token.issued_by !== request.actor) {
    return { code: "token_invalid", message: "review token is not bound to the confirming human" };
  }
  const expected = prefixedHash(sha256(tokenPayload({
    token_version: token.token_version,
    identity: token.identity,
    scope: token.scope,
    lang: token.lang,
    source_content_hash: token.source_content_hash,
    content_hash: token.content_hash,
    issued_for: token.issued_for,
    issued_by: token.issued_by,
    issued_at: token.issued_at,
  })));
  if (token.token_hash !== expected || token.identity !== bundle.identity) {
    return { code: "token_invalid", message: "review token integrity or identity check failed" };
  }
  if (token.source_content_hash !== bundle.canonical.content_hash) {
    return { code: "source_hash_drift", message: "source changed after review token was issued" };
  }
  const currentHash = token.scope === "canonical"
    ? bundle.canonical.content_hash
    : bundle.locales[token.lang as TranslationLocale]?.content_hash;
  if (!currentHash || currentHash !== token.content_hash) {
    return { code: "translation_hash_drift", message: "content changed after review token was issued" };
  }
  if (token.scope === "canonical" && token.lang !== "ja") {
    return { code: "token_invalid", message: "canonical token must be bound to ja" };
  }
  if (token.scope === "locale" && (token.lang !== "zh" && token.lang !== "en")) {
    return { code: "token_invalid", message: "locale token must be bound to zh or en" };
  }
  return null;
}

/** Confirm a canonical or locale draft. The operation is auditable and idempotent. */
export function reviewDraft(
  bundle: EditorialBundle,
  request: ReviewRequest,
): EditorialResult<EditorialBundle> {
  const invalid = ensureCurrent(bundle);
  if (invalid) return { ok: false, error: invalid };
  const target: DerivedStatus = "reviewed";
  const tokenError = validateReviewToken(bundle, request);
  if (tokenError) return { ok: false, error: tokenError };
  const replay = sameOperationReplay(bundle, request.operation_id, target);
  if (replay) return replay;
  if (bundle.canonical.risk_tier === "T2" && request.actor_kind !== "human") {
    return error("sensitive_content_requires_human", "T2 content requires human review");
  }
  if (request.token.scope === "canonical") {
    if (bundle.canonical.review_status === "retracted") return error("already_retracted", "retracted content cannot be reviewed");
    if (bundle.canonical.review_status === "reviewed") {
      return error("identity_conflict", "canonical content is already reviewed with a different operation");
    }
    const next: EditorialBundle = {
      ...bundle,
      canonical: {
        ...bundle.canonical,
        review_status: "reviewed",
        reviewed_by: request.actor,
        reviewed_at: request.at,
      },
    };
    return ok(appendEvent(next, {
      operation_id: request.operation_id,
      scope: "canonical",
      lang: "ja",
      from: bundle.canonical.review_status,
      to: target,
      actor: request.actor,
      actor_kind: request.actor_kind,
      at: request.at,
      reason: request.reason,
      source_content_hash: bundle.canonical.content_hash,
      content_hash: bundle.canonical.content_hash,
    }));
  }
  const lang = request.token.lang as TranslationLocale;
  const locale = bundle.locales[lang];
  if (!locale) return error("invalid_input", "locale draft is missing");
  if (locale.review_status === "retracted") return error("already_retracted", "retracted locale cannot be reviewed");
  if (locale.review_status === "reviewed" && locale.source_content_hash === bundle.canonical.content_hash) {
    return error("identity_conflict", "locale is already reviewed with a different operation");
  }
  const next: EditorialBundle = {
    ...bundle,
    locales: {
      ...bundle.locales,
      [lang]: {
        ...locale,
        review_status: "reviewed",
        reviewed_by: request.actor,
        reviewed_at: request.at,
      },
    },
  };
  return ok(appendEvent(next, {
    operation_id: request.operation_id,
    scope: "locale",
    lang,
    from: locale.review_status,
    to: target,
    actor: request.actor,
    actor_kind: request.actor_kind,
    at: request.at,
    reason: request.reason,
    source_content_hash: bundle.canonical.content_hash,
    content_hash: locale.content_hash,
  }));
}

/** Source changes create a new draft revision and explicitly stale old locales. */
export function updateSourceRevision(
  bundle: EditorialBundle,
  item: DiscoveryItem,
  request: SourceUpdateRequest,
): EditorialResult<EditorialBundle> {
  const invalid = ensureCurrent(bundle);
  if (invalid) return { ok: false, error: invalid };
  if (editorialIdentity(item) !== bundle.identity) {
    return error("identity_conflict", "source update identity does not match editorial bundle");
  }
  const nextHash = editorialContentHash(item);
  if (nextHash === bundle.canonical.content_hash) return ok(bundle, false);
  if (bundle.canonical.review_status === "retracted") {
    return error("already_retracted", "retracted content cannot be revived by source update");
  }
  const replay = sameOperationReplay(bundle, request.operation_id, "draft");
  if (replay) return replay;
  let next: EditorialBundle = {
    ...bundle,
    canonical: {
      ...bundle.canonical,
      published_at: item.published_at,
      content_hash: nextHash,
      title: item.title,
      source_url: item.source_url,
      review_status: "draft",
      reviewed_by: null,
      reviewed_at: null,
      body: item.note,
    },
  };
  next = appendEvent(next, {
    operation_id: request.operation_id,
    scope: "canonical",
    lang: "ja",
    from: bundle.canonical.review_status,
    to: "draft",
    actor: request.actor ?? "editorial-system",
    actor_kind: request.actor_kind ?? "system",
    at: request.at,
    reason: request.reason,
    source_content_hash: nextHash,
    content_hash: nextHash,
  });
  for (const lang of ["zh", "en"] as const) {
    const prior = bundle.locales[lang];
    if (!prior) continue;
    const stale: LocaleContentRecord = {
      ...prior,
      review_status: "stale",
      reviewed_by: null,
      reviewed_at: null,
    };
    next = {
      ...next,
      locales: { ...next.locales, [lang]: stale },
    };
    next = appendEvent(next, {
      operation_id: `${request.operation_id}:${lang}`,
      scope: "locale",
      lang,
      from: prior.review_status,
      to: "stale",
      actor: request.actor ?? "editorial-system",
      actor_kind: request.actor_kind ?? "system",
      at: request.at,
      reason: `source content changed; ${request.reason}`,
      source_content_hash: nextHash,
      content_hash: prior.content_hash,
    });
  }
  return ok(next);
}

/** Retract canonical and locale records in one logical, append-only operation. */
export function retractEditorial(
  bundle: EditorialBundle,
  request: RetractionRequest,
): EditorialResult<EditorialBundle> {
  const invalid = ensureCurrent(bundle);
  if (invalid) return { ok: false, error: invalid };
  const replay = sameOperationReplay(bundle, request.operation_id, "retracted");
  if (replay) return replay;
  if (bundle.canonical.review_status === "retracted") {
    return error("already_retracted", "content is already retracted", { identity: bundle.identity });
  }
  const nextPath = `${bundle.content_path}/index.md`;
  let next: EditorialBundle = {
    ...bundle,
    canonical: {
      ...bundle.canonical,
      review_status: "retracted",
      reviewed_by: null,
      reviewed_at: null,
    },
    retraction: {
      schema_version: "1",
      id: sha256(bundle.identity).slice(0, 16),
      content_path: nextPath,
      status: "active",
      reason: request.reason,
      requested_at: request.at,
      requested_by: request.actor,
    },
  };
  next = appendEvent(next, {
    operation_id: request.operation_id,
    scope: "canonical",
    lang: "ja",
    from: bundle.canonical.review_status,
    to: "retracted",
    actor: request.actor,
    actor_kind: request.actor_kind,
    at: request.at,
    reason: request.reason,
    source_content_hash: bundle.canonical.content_hash,
    content_hash: bundle.canonical.content_hash,
  });
  for (const lang of ["zh", "en"] as const) {
    const prior = bundle.locales[lang];
    if (!prior) continue;
    next = {
      ...next,
      locales: {
        ...next.locales,
        [lang]: { ...prior, review_status: "retracted", reviewed_by: null, reviewed_at: null },
      },
    };
    next = appendEvent(next, {
      operation_id: `${request.operation_id}:${lang}`,
      scope: "locale",
      lang,
      from: prior.review_status,
      to: "retracted",
      actor: request.actor,
      actor_kind: request.actor_kind,
      at: request.at,
      reason: request.reason,
      source_content_hash: bundle.canonical.content_hash,
      content_hash: prior.content_hash,
    });
  }
  return ok(next);
}

function localeProjection(bundle: EditorialBundle, lang: TranslationLocale): PublicationLocale {
  const locale = bundle.locales[lang];
  if (!locale) {
    return {
      status: bundle.canonical.review_status,
      indexable: false,
      source_content_hash: bundle.canonical.content_hash,
      content_hash: bundle.canonical.content_hash,
    };
  }
  const real = locale.review_status === "reviewed" && locale.source_content_hash === bundle.canonical.content_hash;
  return {
    status: bundle.canonical.review_status === "retracted"
      ? "retracted"
      : real
        ? "published"
        : locale.review_status,
    indexable: bundle.canonical.review_status === "reviewed" && real,
    source_content_hash: locale.source_content_hash,
    content_hash: locale.content_hash,
  };
}

/** Build-only projection: canonical reviewed/current becomes published; no files are mutated. */
export function derivePublication(bundle: EditorialBundle): PublicationProjection {
  const canonicalPublished = bundle.canonical.review_status === "reviewed" && !bundle.retraction;
  const status: DerivedStatus = bundle.canonical.review_status === "reviewed" && !bundle.retraction
    ? "published"
    : bundle.retraction
      ? "retracted"
      : bundle.canonical.review_status;
  return {
    identity: bundle.identity,
    status,
    indexable: canonicalPublished,
    canonical: {
      status,
      indexable: canonicalPublished,
      content_hash: bundle.canonical.content_hash,
    },
    locales: {
      zh: localeProjection(bundle, "zh"),
      en: localeProjection(bundle, "en"),
    },
  };
}

function serializeMarkdown(data: Record<string, unknown>, body: string): string {
  return `---\n${yaml.dump(data, { sortKeys: true, noRefs: true })}---\n${body.trim()}\n`;
}

function canonicalData(record: CanonicalContentRecord): Record<string, unknown> {
  const data = { ...record } as Record<string, unknown>;
  delete data.body;
  return data;
}

function localeData(record: LocaleContentRecord): Record<string, unknown> {
  const data = { ...record } as Record<string, unknown>;
  delete data.body;
  return data;
}

function ensureDirectorySafe(dir: string): void {
  if (fs.existsSync(dir)) {
    const stat = fs.lstatSync(dir);
    if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("editorial target is not a directory");
  }
}

function atomicFileWrite(file: string, content: string): void {
  const dir = path.dirname(file);
  ensureDirectorySafe(dir);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = path.join(dir, `.editorial-tmp-${process.pid}-${randomUUID().slice(0, 8)}`);
  try {
    fs.writeFileSync(tmp, content, { encoding: "utf8", flag: "wx" });
    fs.renameSync(tmp, file);
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* best effort */ }
    throw err;
  }
}

function assertSafeComponents(root: string, target: string): void {
  const rootAbs = path.resolve(root);
  const targetAbs = path.resolve(target);
  if (targetAbs !== rootAbs && !targetAbs.startsWith(`${rootAbs}${path.sep}`)) {
    throw new Error("editorial path escapes root");
  }
  let cursor = rootAbs;
  const relative = path.relative(rootAbs, targetAbs);
  for (const part of relative.split(path.sep)) {
    if (!part || part === ".") continue;
    cursor = path.join(cursor, part);
    if (!fs.existsSync(cursor)) continue;
    const stat = fs.lstatSync(cursor);
    if (stat.isSymbolicLink()) throw new Error("editorial path contains a symlink");
  }
}

function stageBundleFiles(bundle: EditorialBundle, stageDir: string): void {
  fs.mkdirSync(stageDir, { recursive: true });
  atomicFileWrite(path.join(stageDir, "index.md"), serializeMarkdown(canonicalData(bundle.canonical), bundle.canonical.body));
  for (const lang of ["zh", "en"] as const) {
    const locale = bundle.locales[lang];
    if (!locale) continue;
    atomicFileWrite(path.join(stageDir, `content.${lang}.md`), serializeMarkdown(localeData(locale), locale.body));
  }
  atomicFileWrite(path.join(stageDir, "editorial-history.json"), `${JSON.stringify(bundle.history, null, 2)}\n`);
}

/**
 * Persist one bundle with validation before any write and a directory-level
 * swap. Invalid transitions and mid-commit failures leave the prior content
 * and retraction record intact.
 */
export function persistEditorialBundle(
  bundle: EditorialBundle,
  root = REPO_ROOT,
): EditorialResult<string> {
  const invalid = ensureCurrent(bundle);
  if (invalid) return { ok: false, error: invalid };
  const rootAbs = path.resolve(root);
  const contentDir = path.resolve(rootAbs, bundle.content_path);
  const contentParent = path.dirname(contentDir);
  const retractionDir = path.join(rootAbs, "content", "retractions");
  const retractionFile = bundle.retraction
    ? path.join(retractionDir, `${bundle.retraction.id}.json`)
    : undefined;
  const stagingDir = path.join(contentParent, `.editorial-staging-${process.pid}-${randomUUID().slice(0, 8)}`);
  const targetBackup = path.join(contentParent, `.editorial-backup-${process.pid}-${randomUUID().slice(0, 8)}`);
  const retractionStage = retractionFile
    ? path.join(retractionDir, `.editorial-staging-${process.pid}-${randomUUID().slice(0, 8)}.json`)
    : undefined;
  const retractionBackup = retractionFile
    ? path.join(retractionDir, `.editorial-backup-${process.pid}-${randomUUID().slice(0, 8)}.json`)
    : undefined;
  let targetMoved = false;
  let targetInstalled = false;
  let retractionMoved = false;
  let retractionInstalled = false;
  try {
    ensureDirectorySafe(rootAbs);
    fs.mkdirSync(rootAbs, { recursive: true });
    assertSafeComponents(rootAbs, contentParent);
    assertSafeComponents(rootAbs, contentDir);
    if (retractionFile) {
      assertSafeComponents(rootAbs, retractionDir);
      assertSafeComponents(rootAbs, retractionFile);
    }
    fs.mkdirSync(contentParent, { recursive: true });
    if (fs.existsSync(contentDir)) {
      const stat = fs.lstatSync(contentDir);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("editorial content target is not a directory");
      fs.cpSync(contentDir, stagingDir, { recursive: true, errorOnExist: true });
    } else {
      fs.mkdirSync(stagingDir, { recursive: true });
    }
    stageBundleFiles(bundle, stagingDir);
    if (retractionFile && retractionStage && bundle.retraction) {
      fs.mkdirSync(retractionDir, { recursive: true });
      atomicFileWrite(retractionStage, `${JSON.stringify(bundle.retraction, null, 2)}\n`);
    }

    if (fs.existsSync(contentDir)) {
      fs.renameSync(contentDir, targetBackup);
      targetMoved = true;
    }
    fs.renameSync(stagingDir, contentDir);
    targetInstalled = true;
    if (retractionFile && retractionStage && retractionBackup) {
      if (fs.existsSync(retractionFile)) {
        fs.renameSync(retractionFile, retractionBackup);
        retractionMoved = true;
      }
      fs.renameSync(retractionStage, retractionFile);
      retractionInstalled = true;
    }

    if (targetMoved) fs.rmSync(targetBackup, { recursive: true, force: true });
    if (retractionMoved && retractionBackup) fs.rmSync(retractionBackup, { force: true });
    return ok(bundle.content_path);
  } catch (err) {
    // Roll back the retraction first, then the content directory. Every
    // rename is guarded so a failure in cleanup never hides the original
    // structured error.
    try {
      if (retractionInstalled && retractionFile) fs.rmSync(retractionFile, { force: true });
      if (retractionMoved && retractionBackup && retractionFile && fs.existsSync(retractionBackup)) {
        fs.renameSync(retractionBackup, retractionFile);
      }
    } catch { /* best effort rollback */ }
    try {
      if (targetInstalled && fs.existsSync(contentDir)) fs.rmSync(contentDir, { recursive: true, force: true });
      if (targetMoved && fs.existsSync(targetBackup)) fs.renameSync(targetBackup, contentDir);
    } catch { /* best effort rollback */ }
    try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch { /* best effort */ }
    if (retractionStage) {
      try { fs.rmSync(retractionStage, { force: true }); } catch { /* best effort */ }
    }
    try { if (fs.existsSync(targetBackup)) fs.rmSync(targetBackup, { recursive: true, force: true }); } catch { /* best effort */ }
    if (retractionBackup) {
      try { if (fs.existsSync(retractionBackup)) fs.rmSync(retractionBackup, { force: true }); } catch { /* best effort */ }
    }
    return error("write_failed", `editorial bundle write failed: ${(err as Error).message}`);
  }
}

function parseCanonical(file: string): CanonicalContentRecord {
  const parsed = matter(fs.readFileSync(file, "utf8"));
  return { ...(parsed.data as CanonicalContentRecord), body: parsed.content.trim() };
}

function parseLocale(file: string, lang: TranslationLocale): LocaleContentRecord {
  const parsed = matter(fs.readFileSync(file, "utf8"));
  return { ...(parsed.data as LocaleContentRecord), lang, body: parsed.content.trim() };
}

export function readEditorialBundle(
  root: string,
  contentPath: string,
): EditorialResult<EditorialBundle> {
  const dir = path.join(root, contentPath);
  try {
    const canonical = parseCanonical(path.join(dir, "index.md"));
    const history = JSON.parse(fs.readFileSync(path.join(dir, "editorial-history.json"), "utf8")) as EditorialHistory;
    const locales: Partial<Record<TranslationLocale, LocaleContentRecord>> = {};
    for (const lang of ["zh", "en"] as const) {
      const file = path.join(dir, `content.${lang}.md`);
      if (fs.existsSync(file)) locales[lang] = parseLocale(file, lang);
    }
    const retractionId = sha256(`${canonical.source_id}|${canonical.source_item_id}`).slice(0, 16);
    const retractionFile = path.join(root, "content", "retractions", `${retractionId}.json`);
    const retraction = fs.existsSync(retractionFile)
      ? JSON.parse(fs.readFileSync(retractionFile, "utf8")) as RetractionRecord
      : undefined;
    const bundle: EditorialBundle = {
      identity: `${canonical.source_id}|${canonical.source_item_id}`,
      content_path: contentPath,
      canonical,
      locales,
      history,
      ...(retraction ? { retraction } : {}),
    };
    const invalid = ensureCurrent(bundle);
    return invalid ? { ok: false, error: invalid } : ok(bundle, false);
  } catch (err) {
    return error("invalid_input", `cannot read editorial bundle: ${(err as Error).message}`);
  }
}

/** Materialize a normalized discovery item, updating the same identity only as a new revision. */
export function materializeDiscovery(
  item: DiscoveryItem,
  options: DraftOptions & { root?: string } = {},
): EditorialResult<EditorialBundle> {
  const root = options.root ?? REPO_ROOT;
  const contentPath = (() => {
    try { return contentRelativePath(item); } catch { return ""; }
  })();
  if (!contentPath) return error("invalid_input", "invalid discovery content path");
  const existingFile = path.join(root, contentPath, "index.md");
  if (!fs.existsSync(existingFile)) {
    const draft = createDraftFromDiscovery(item, options);
    if (!draft.ok) return draft;
    const written = persistEditorialBundle(draft.value, root);
    return written.ok ? ok(draft.value) : written;
  }
  const current = readEditorialBundle(root, contentPath);
  if (!current.ok) return current;
  const sourceRequest: SourceUpdateRequest = {
    at: options.at ?? "2026-01-01T00:00:00Z",
    reason: options.reason ?? "normalized discovery source revision",
    operation_id: `source:${editorialContentHash(item)}`,
    ...(options.actor !== undefined ? { actor: options.actor } : {}),
    ...(options.actor_kind !== undefined ? { actor_kind: options.actor_kind } : {}),
  };
  const updated = updateSourceRevision(current.value, item, sourceRequest);
  if (!updated.ok || !updated.changed) return updated;
  const written = persistEditorialBundle(updated.value, root);
  return written.ok ? ok(updated.value) : written;
}
