import { describe, expect, it } from "vitest";

import { loadNews } from "../src/lib/content.ts";
import { buildManifest } from "../tools/schema/postbuild.ts";
import { buildSearchIndex } from "../src/lib/search.ts";
import { validateFile } from "../tools/schema/validate.ts";

describe("manifest.json（build-time artifact）", () => {
  it("covers every content item with schema-shaped entries", () => {
    const items = loadNews();
    const manifest = buildManifest(items);
    expect(manifest.entries.length).toBe(items.length);
    const required = ["path", "kind", "source_id", "source_item_id", "content_hash", "review_status", "locales"];
    for (const e of manifest.entries) {
      for (const k of required) expect(e).toHaveProperty(k);
      expect(["en", "ja", "zh"]).toEqual(Object.keys(e.locales).sort());
    for (const lang of ["ja", "zh", "en"] as const) {
      expect(e.locales[lang]).toHaveProperty("status");
      expect(e.locales[lang]).toHaveProperty("hash");
      expect(e.locales[lang]).toHaveProperty("reviewed_by");
    }
    }
  });

  it("is deterministic: same input → identical serialization (sorted)", () => {
    const items = loadNews();
    const a = JSON.stringify(buildManifest(items), null, 2);
    const b = JSON.stringify(buildManifest(items), null, 2);
    expect(a).toBe(b);
  });

  it("conforms to manifest.schema.json (build-time artifact shape)", () => {
    const items = loadNews();
    const manifest = {
      manifest_version: "1",
      generated_at: "2026-08-09T09:00:00+09:00",
      entries: buildManifest(items).entries,
    };
    const r = validateFile("manifest.schema.json", manifest);
    expect(r.valid, r.errors).toBe(true);
  });
});

describe("search.json（确定性 fallback 索引）", () => {
  it("indexes every locale path deterministically", () => {
    const items = loadNews();
    const index = buildSearchIndex(items);
    expect(index.length).toBeGreaterThan(0);
    for (const row of index) {
      expect(row).toHaveProperty("lang");
      expect(row).toHaveProperty("slug");
      expect(row).toHaveProperty("path");
      expect(row).toHaveProperty("title");
      expect(row).toHaveProperty("body");
    }
    const a = JSON.stringify(index);
    const b = JSON.stringify(buildSearchIndex(items));
    expect(a).toBe(b);
  });

  it("missing translation → falls back to canonical body in search index", () => {
    const items = loadNews();
    const jaOnly = items.find((i) => i.slug.includes("002"));
    const zhRow = buildSearchIndex([jaOnly!]).find((r: { lang: string }) => r.lang === "zh");
    expect(zhRow?.body).toBe(jaOnly!.canonicalBody);
  });
});
