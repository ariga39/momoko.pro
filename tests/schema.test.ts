import fs from "node:fs";
import { describe, expect, it } from "vitest";

import {
  collectContentFiles,
  REPO_ROOT,
  validateContentFile,
  validateFile,
  validateSources,
} from "../tools/schema/validate.ts";
import { loadNews, resolveLocale } from "../src/lib/content.ts";

const fakeSource = (over: Record<string, unknown> = {}) => ({
  source_id: "S9",
  name_zh: "合成探针来源",
  canonical_url: "https://example.com/",
  robots_txt_url: "https://example.com/robots.txt",
  robots_http: "200",
  robots_note: "Allow: /",
  terms_url: "https://example.com/terms",
  terms_note: "公开条款允许抓取",
  robots_approved: { allowed: false, evidence: "未批准（默认）" },
  terms_approved: { allowed: false, evidence: "未批准（默认）" },
  automated_fetch: false,
  fetch_frequency: "manual",
  cache_boundary: "仅归档 URL",
  stop_condition: "条款变更即停止",
  ...over,
});

describe("schemas/source.schema.json — cron seam 机器契约", () => {
  const wrap = (s: unknown) => ({ schema_version: "1", sources: [s] });

  it("approved automated_fetch=true with non-manual frequency passes", () => {
    const r = validateFile("source.schema.json", wrap(fakeSource({
      automated_fetch: true,
      fetch_frequency: "daily",
      robots_approved: { allowed: true, evidence: "robots Allow: /（2026-08-09 核验）" },
      terms_approved: { allowed: true, evidence: "条款明确允许抓取（2026-08-09 核验）" },
    })));
    expect(r.valid).toBe(true);
  });

  it("automated_fetch=true cannot be manual frequency", () => {
    const r = validateFile("source.schema.json", wrap(fakeSource({ automated_fetch: true })));
    expect(r.valid).toBe(false);
  });

  it("automated_fetch=false must be manual frequency", () => {
    const r = validateFile("source.schema.json", wrap(fakeSource({ automated_fetch: false, fetch_frequency: "weekly" })));
    expect(r.valid).toBe(false);
  });

  it("fetch_frequency not in enum rejected", () => {
    const r = validateFile("source.schema.json", wrap(fakeSource({ fetch_frequency: "hourly" })));
    expect(r.valid).toBe(false);
  });

  it("config/sources.json validates and all S1-S5 are manual (current evidence)", () => {
    const r = validateSources();
    expect(r.valid).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(`${REPO_ROOT}/config/sources.json`, "utf-8"));
    for (const s of cfg.sources) {
      expect(s.automated_fetch).toBe(false);
      expect(s.fetch_frequency).toBe("manual");
    }
  });
});

describe("schemas/content.schema.json — reviewed 条件约束", () => {
  it("all content fixtures pass their schema", () => {
    const files = collectContentFiles();
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const r = validateContentFile(f);
      expect(r.valid, `${f.path}: ${r.errors}`).toBe(true);
    }
  });

  it("reviewed requires non-empty reviewer + time", () => {
    const base = {
      schema_version: "1",
      kind: "news",
      source_id: "S1",
      source_item_id: "x",
      published_at: "2026-08-08T00:00:00+09:00",
      content_hash: "sha256:" + "a".repeat(64),
      risk_tier: "T1",
      lang: "ja",
      title: "t",
      source_url: "https://example.com/1",
      body: "b",
      review_status: "reviewed",
    };
    expect(validateFile("content.schema.json", base).valid).toBe(false); // no reviewer/time
    expect(
      validateFile("content.schema.json", {
        ...base,
        reviewed_by: "ariga39",
        reviewed_at: "2026-08-08T01:00:00+09:00",
      }).valid,
    ).toBe(true);
  });

  it("published is not a canonical review_status", () => {
    const base = {
      schema_version: "1",
      kind: "news",
      source_id: "S1",
      source_item_id: "x",
      published_at: "2026-08-08T00:00:00+09:00",
      content_hash: "sha256:" + "a".repeat(64),
      risk_tier: "T1",
      lang: "ja",
      title: "t",
      source_url: "https://example.com/1",
      body: "b",
      review_status: "published",
    };
    expect(validateFile("content.schema.json", base).valid).toBe(false);
  });
});

describe("content loader — 三语与缺译回退", () => {
  it("loads all news items and resolves locale with ja fallback", () => {
    const items = loadNews();
    expect(items.length).toBe(2);
    const item1 = items.find((i) => i.slug.includes("001"));
    expect(item1?.locales.ja).toBeUndefined(); // index.md is canonical, not a locale file
    expect(item1?.locales.zh).toBeTruthy();
    expect(item1?.locales.en).toBeTruthy();
    expect(item1?.canonical.title).toBeTruthy();
    // item2 carries a translation draft, which still falls back to canonical (ja) body
    const item2 = items.find((i) => i.slug.includes("002"));
    expect(item2?.locales.zh?.meta.reviewStatus).toBe("draft");
    expect(item2?.locales.en?.meta.reviewStatus).toBe("draft");
    const resolved = resolveLocale(item2!, "zh");
    expect(resolved.translated).toBe(false);
    expect(resolved.body).toBe(item2!.canonicalBody);
    expect(loadNews().length).toBeGreaterThan(0);
  });
});
