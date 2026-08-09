import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  hasTranslation,
  isRealTranslation,
  loadNews,
  resolveLocale,
  REPO_ROOT,
} from "../src/lib/content.ts";

// Translation eligibility（design §1.2）: body 非空、reviewed、
// source_content_hash === canonical hash、未 retracted，否则 fail-closed 回退。

describe("translation eligibility — fail-closed", () => {
  it("fixture 001 zh is a real translation; 002 zh is a draft record and not eligible", () => {
    const items = loadNews();
    const item1 = items.find((i) => i.slug.includes("001"))!;
    const item2 = items.find((i) => i.slug.includes("002"))!;
    expect(isRealTranslation(item1, "zh")).toBe(true);
    expect(hasTranslation(item1, "zh")).toBe(true);
    expect(resolveLocale(item1, "zh").translated).toBe(true);
    expect(isRealTranslation(item2, "zh")).toBe(false);
    expect(item2.locales.zh?.meta.reviewStatus).toBe("draft");
    expect(resolveLocale(item2, "zh").translated).toBe(false);
    expect(resolveLocale(item2, "zh").body).toBe(item2.canonicalBody);
  });

  it("draft locale is not a real translation (review_status !== reviewed)", () => {
    const items = loadNews();
    const item2 = items.find((i) => i.slug.includes("002"))!;
    // 002 canonical is draft; its locales fall back regardless of presence.
    expect(isRealTranslation(item2, "ja")).toBe(false);
  });

  it("empty-body translation is not a real translation", () => {
    const items = loadNews();
    const item1 = items.find((i) => i.slug.includes("001"))!;
    // simulate an empty-body locale file
    const clone: typeof item1 = {
      ...item1,
      locales: {
        ...item1.locales,
        en: { ...item1.locales.en!, body: "   " },
      },
    };
    expect(isRealTranslation(clone, "en")).toBe(false);
  });

  it("source_content_hash mismatch (drift) is not a real translation", () => {
    const items = loadNews();
    const item1 = items.find((i) => i.slug.includes("001"))!;
    const clone: typeof item1 = {
      ...item1,
      locales: {
        ...item1.locales,
        en: { ...item1.locales.en!, meta: { ...item1.locales.en!.meta, sourceContentHash: "sha256:" + "0".repeat(64) } },
      },
    };
    expect(isRealTranslation(clone, "en")).toBe(false);
  });

  it("retracted content is not a real translation (and canonical stays fallback)", () => {
    const items = loadNews();
    const item1 = items.find((i) => i.slug.includes("001"))!;
    // write a temp retraction record pointing at item1, then reload
    const retrDir = path.join(REPO_ROOT, "content", "retractions");
    fs.mkdirSync(retrDir, { recursive: true });
    const file = path.join(retrDir, "probe.json");
    fs.writeFileSync(
      file,
      JSON.stringify({
        schema_version: "1",
        id: "probe",
        content_path: `content/news/${item1.slug}/index.md`,
        status: "active",
        reason: "synthetic probe",
        requested_at: "2026-08-09T00:00:00+09:00",
        requested_by: "reviewer-demo",
      }),
    );
    try {
      const reloaded = loadNews().find((i) => i.slug.includes("001"))!;
      expect(isRealTranslation(reloaded, "zh")).toBe(false);
      expect(resolveLocale(reloaded, "zh").translated).toBe(false);
    } finally {
      fs.rmSync(file, { force: true });
      fs.rmdirSync(retrDir, { recursive: true });
    }
  });
});
