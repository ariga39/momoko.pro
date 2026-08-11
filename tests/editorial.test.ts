import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { normalizeDiscovery, type DiscoveryItem } from "../tools/ingest/ingest.ts";
import {
  addTranslationDraft,
  createDraftFromDiscovery,
  derivePublication,
  editorialContentHash,
  issueReviewToken,
  materializeDiscovery,
  persistEditorialBundle,
  readEditorialBundle,
  retractEditorial,
  reviewDraft,
  updateSourceRevision,
  type EditorialBundle,
  type ReviewRequest,
} from "../tools/editorial/editorial.ts";
import { validateFile } from "../tools/schema/validate.ts";
import { loadNews, loadPublishedNews } from "../src/lib/content.ts";
import { buildManifest } from "../tools/schema/postbuild.ts";

const roots: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momoko-editorial-"));
  roots.push(root);
  return root;
}

function discovery(over: Partial<DiscoveryItem> = {}): DiscoveryItem {
  const raw = {
    schema_version: "1",
    source_id: "S1",
    source_item_id: "phase2c-synth-001",
    source_url: "https://example.com/synthetic/phase2c-001",
    published_at: "2026-08-09T10:00:00+09:00",
    title: "（合成）編集ライフサイクル検証",
    lang: "ja",
    note: "合成の事実ノート。外部本文ではありません。",
    ...over,
  };
  const item = normalizeDiscovery(raw);
  expect(item).not.toBeNull();
  return item!;
}

function reviewedBundle(): EditorialBundle {
  const draft = createDraftFromDiscovery(discovery(), {
    actor: "editorial-system",
    at: "2026-08-09T01:00:00Z",
    translation_drafts: [
      { lang: "zh", body: "合成中文译文。", actor: "translator-ai", actor_kind: "ai", model_version: "synthetic-model@1" },
      { lang: "en", body: "Synthetic English translation.", actor: "translator-ai", actor_kind: "ai", model_version: "synthetic-model@1" },
    ],
  });
  expect(draft.ok).toBe(true);
  let bundle = draft.ok ? draft.value : (() => { throw new Error("draft failed"); })();
  const review = (scope: "canonical" | "locale", lang: "ja" | "zh" | "en", operationId: string) => {
    const token = issueReviewToken(bundle, {
      scope,
      lang,
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T02:00:00Z",
    });
    expect(token.ok).toBe(true);
    const req: ReviewRequest = {
      token: token.ok ? token.value : (() => { throw new Error("token failed"); })(),
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T02:00:00Z",
      reason: `synthetic ${scope} review`,
      operation_id: operationId,
    };
    const result = reviewDraft(bundle, req);
    expect(result.ok).toBe(true);
    bundle = result.ok ? result.value : (() => { throw new Error("review failed"); })();
  };
  review("canonical", "ja", "review:canonical");
  review("locale", "zh", "review:zh");
  review("locale", "en", "review:en");
  return bundle;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("Phase 2C editorial lifecycle", () => {
  it("turns a normalized discovery into content-schema canonical ja plus zh/en draft records", () => {
    const result = createDraftFromDiscovery(discovery(), {
      actor: "editorial-system",
      at: "2026-08-09T01:00:00Z",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.canonical.lang).toBe("ja");
    expect(result.value.canonical.review_status).toBe("draft");
    expect(result.value.locales.zh?.review_status).toBe("draft");
    expect(result.value.locales.en?.review_status).toBe("draft");
    expect(validateFile("content.schema.json", result.value.canonical).valid).toBe(true);
    expect(validateFile("locale.schema.json", result.value.locales.zh).valid).toBe(true);
    expect(validateFile("locale.schema.json", result.value.locales.en).valid).toBe(true);
    expect(result.value.history.events.map((event) => event.to)).toEqual(["draft", "draft", "draft"]);
    expect(new Set(result.value.history.events.map((event) => event.operation_id)).size).toBe(3);
  });

  it("keeps AI and T2 content behind an explicit human review gate", () => {
    const draft = createDraftFromDiscovery(discovery(), { risk_tier: "T2" });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const aiToken = issueReviewToken(draft.value, {
      scope: "canonical",
      lang: "ja",
      actor: "summarizer",
      actor_kind: "ai",
      at: "2026-08-09T01:00:00Z",
    });
    expect(aiToken).toMatchObject({ ok: false, error: { code: "ai_review_forbidden" } });
    const humanToken = issueReviewToken(draft.value, {
      scope: "canonical",
      lang: "ja",
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T01:00:00Z",
    });
    expect(humanToken.ok).toBe(true);
    if (!humanToken.ok) return;
    const aiConfirm = reviewDraft(draft.value, {
      token: humanToken.value,
      actor: "summarizer",
      actor_kind: "ai",
      at: "2026-08-09T02:00:00Z",
      reason: "AI attempted promotion",
      operation_id: "review:ai-forbidden",
    });
    expect(aiConfirm).toMatchObject({ ok: false, error: { code: "ai_review_forbidden" } });
    expect(draft.value.canonical.review_status).toBe("draft");
  });

  it("accepts an AI translation only as a draft and requires a new human token for review", () => {
    const draft = createDraftFromDiscovery(discovery());
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const translated = addTranslationDraft(draft.value, {
      lang: "zh",
      body: "合成中文草稿。",
      actor: "translator-ai",
      actor_kind: "ai",
      reason: "AI translation draft",
    });
    expect(translated).toMatchObject({ ok: true, changed: true });
    if (!translated.ok) return;
    expect(translated.value.locales.zh?.review_status).toBe("draft");
    const token = issueReviewToken(translated.value, {
      scope: "locale",
      lang: "zh",
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T02:00:00Z",
    });
    expect(token.ok).toBe(true);
  });

  it("reviews all three language records and derives published without mutating canonical published status", () => {
    const bundle = reviewedBundle();
    const projection = derivePublication(bundle);
    expect(projection.status).toBe("published");
    expect(projection.indexable).toBe(true);
    expect(projection.locales.zh!.status).toBe("published");
    expect(projection.locales.en!.status).toBe("published");
    expect(projection.locales.zh!.indexable).toBe(true);
    expect(bundle.canonical.review_status).toBe("reviewed");
    expect(bundle.history.events.filter((event) => event.to === "reviewed")).toHaveLength(3);
  });

  it("rejects a review token after source drift and stales old translations", () => {
    const draft = createDraftFromDiscovery(discovery(), {
      translation_drafts: [
        { lang: "zh", body: "旧中文", actor: "translator-ai", actor_kind: "ai" },
        { lang: "en", body: "Old English", actor: "translator-ai", actor_kind: "ai" },
      ],
    });
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const token = issueReviewToken(draft.value, {
      scope: "canonical",
      lang: "ja",
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T02:00:00Z",
    });
    expect(token.ok).toBe(true);
    if (!token.ok) return;
    const changed = updateSourceRevision(draft.value, discovery({ note: "新的合成事实笔记。" }), {
      actor: "editorial-system",
      actor_kind: "system",
      at: "2026-08-09T03:00:00Z",
      reason: "source bytes changed",
      operation_id: "source:revision-2",
    });
    expect(changed.ok).toBe(true);
    if (!changed.ok) return;
    expect(changed.value.canonical.review_status).toBe("draft");
    expect(changed.value.locales.zh?.review_status).toBe("stale");
    expect(changed.value.locales.en?.review_status).toBe("stale");
    expect(derivePublication(changed.value).indexable).toBe(false);
    expect(derivePublication(changed.value).locales.zh!.indexable).toBe(false);
    const root = tempRoot();
    expect(persistEditorialBundle(draft.value, root).ok).toBe(true);
    expect(persistEditorialBundle(changed.value, root).ok).toBe(true);
    const reread = readEditorialBundle(root, changed.value.content_path);
    expect(reread.ok).toBe(true);
    if (reread.ok) {
      expect(reread.value.history.events).toHaveLength(changed.value.history.events.length);
      expect(reread.value.history.events[0]?.operation_id).toBe(draft.value.history.events[0]?.operation_id);
      expect(reread.value.history.events.at(-1)?.to).toBe("stale");
    }
    const staleToken = reviewDraft(changed.value, {
      token: token.value,
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T04:00:00Z",
      reason: "old token",
      operation_id: "review:stale-token",
    });
    expect(staleToken).toMatchObject({ ok: false, error: { code: "source_hash_drift" } });
    expect(changed.value.history.events.some((event) => event.to === "stale" && event.lang === "zh")).toBe(true);
  });

  it("is idempotent for the same operation and rejects a different replay", () => {
    const draft = createDraftFromDiscovery(discovery());
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const token = issueReviewToken(draft.value, {
      scope: "canonical",
      lang: "ja",
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T02:00:00Z",
    });
    expect(token.ok).toBe(true);
    if (!token.ok) return;
    const request: ReviewRequest = {
      token: token.value,
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T02:00:00Z",
      reason: "approved synthetic content",
      operation_id: "review:canonical-idempotent",
    };
    const first = reviewDraft(draft.value, request);
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const replay = reviewDraft(first.value, request);
    expect(replay).toMatchObject({ ok: true, changed: false });
    if (!replay.ok) return;
    const different = reviewDraft(first.value, { ...request, operation_id: "review:other" });
    expect(different).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
    expect(first.value.history.events).toHaveLength(draft.value.history.events.length + 1);
  });

  it("retracts canonical and locale projection together and writes a redacted retraction record", () => {
    const bundle = reviewedBundle();
    const retracted = retractEditorial(bundle, {
      actor: "human-reviewer",
      actor_kind: "human",
      at: "2026-08-09T05:00:00Z",
      reason: "synthetic withdrawal probe",
      operation_id: "retract:synthetic-001",
    });
    expect(retracted.ok).toBe(true);
    if (!retracted.ok) return;
    const projection = derivePublication(retracted.value);
    expect(projection.status).toBe("retracted");
    expect(projection.indexable).toBe(false);
    expect(projection.locales.zh!.status).toBe("retracted");
    expect(projection.locales.en!.status).toBe("retracted");
    expect(retracted.value.history.events.filter((event) => event.to === "retracted")).toHaveLength(3);
    const root = tempRoot();
    const written = persistEditorialBundle(retracted.value, root);
    expect(written.ok).toBe(true);
    if (!written.ok) return;
    const record = JSON.parse(fs.readFileSync(path.join(root, "content", "retractions", `${retracted.value.retraction!.id}.json`), "utf8"));
    expect(record).toMatchObject({ status: "active", requested_by: "human-reviewer" });
    const reread = readEditorialBundle(root, retracted.value.content_path);
    expect(reread).toMatchObject({ ok: true, changed: false });
  });

  it("materializes the same normalized discovery once and treats a no-change replay as quiet", () => {
    const root = tempRoot();
    const item = discovery();
    const first = materializeDiscovery(item, { root, at: "2026-08-09T01:00:00Z" });
    expect(first).toMatchObject({ ok: true, changed: true });
    const second = materializeDiscovery(item, { root, at: "2026-08-09T01:00:00Z" });
    expect(second).toMatchObject({ ok: true, changed: false });
    if (!first.ok) return;
    expect(first.value.canonical.content_hash).toBe(editorialContentHash(item));
    expect(fs.existsSync(path.join(root, first.value.content_path, "editorial-history.json"))).toBe(true);
  });

  it("rejects a source update identity collision before writing", () => {
    const draft = createDraftFromDiscovery(discovery());
    expect(draft.ok).toBe(true);
    if (!draft.ok) return;
    const result = updateSourceRevision(draft.value, discovery({ source_item_id: "other" }), {
      at: "2026-08-09T03:00:00Z",
      reason: "collision",
      operation_id: "source:collision",
    });
    expect(result).toMatchObject({ ok: false, error: { code: "identity_conflict" } });
    expect(draft.value.history.events).toHaveLength(3);
  });

  it("public archive/build projection excludes draft and retracted synthetic records", () => {
    const current = loadPublishedNews();
    expect(current.some((item) => item.slug.includes("001"))).toBe(true);
    expect(current.some((item) => item.slug.includes("002"))).toBe(false);
    expect(current.some((item) => item.slug.includes("003"))).toBe(false);
    // The public helper remains fail-closed even if a caller accidentally
    // hands it the full loader result instead of the published projection.
    const manifest = buildManifest(loadNews());
    const published = manifest.entries.find((entry) => entry.source_item_id.includes("001"));
    expect(published?.review_status).toBe("published");
    expect(published?.locales.zh.status).toBe("published");
    expect(published?.locales.en.status).toBe("published");
    expect(manifest.entries.some((entry) => entry.source_item_id.includes("002"))).toBe(false);
    expect(manifest.entries.some((entry) => entry.source_item_id.includes("003"))).toBe(false);
  });
});
