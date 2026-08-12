import { afterEach, describe, expect, it } from "vitest";

import { loadProfiles, loadPublishedProfiles } from "../src/lib/encyclopedia.ts";
import { type SearchRow } from "../src/lib/search.ts";

const SYNTHETIC_ROOT = "tests/fixtures/content-package/synthetic";

const originalRoot = process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
const originalMode = process.env.MOMOKO_CONTENT_PACKAGE_MODE;
const originalPublicBuild = process.env.PUBLIC_BUILD;

afterEach(() => {
  if (originalRoot === undefined) delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
  else process.env.MOMOKO_CONTENT_PACKAGE_ROOT = originalRoot;
  if (originalMode === undefined) delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
  else process.env.MOMOKO_CONTENT_PACKAGE_MODE = originalMode;
  if (originalPublicBuild === undefined) delete process.env.PUBLIC_BUILD;
  else process.env.PUBLIC_BUILD = originalPublicBuild;
});

function useProductionRoot(): void {
  delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
  delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
  delete process.env.PUBLIC_BUILD;
}

function useSyntheticRoot(): void {
  process.env.MOMOKO_CONTENT_PACKAGE_ROOT = SYNTHETIC_ROOT;
  process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
  delete process.env.PUBLIC_BUILD;
}

describe("buildProfileSearchIndex — profile search rows (Cycle S1)", () => {
  it("produces exactly 3 deterministic rows (ja/zh/en) for the approved profile with localized title/path/body", async () => {
    useProductionRoot();
    const { buildProfileSearchIndex } = await import("../src/lib/search.ts");
    const profiles = loadPublishedProfiles();
    expect(profiles).toHaveLength(1);

    const rows = buildProfileSearchIndex(profiles);
    expect(rows).toHaveLength(3);
    expect(rows.map((r: SearchRow) => r.lang).sort()).toEqual(["en", "ja", "zh"]);

    const ja = rows.find((r: SearchRow) => r.lang === "ja")!;
    expect(ja.path).toBe("/ja/encyclopedia/");
    expect(ja.title).toBe("周防桃子");
    expect(ja.body).toContain("生意気？強がり？小さくて意地っぱりな妹系アイドル！");
    expect(ja.body).toContain("渡部恵子");
    expect(ja.body).toContain("11月6日");

    const zh = rows.find((r: SearchRow) => r.lang === "zh")!;
    expect(zh.path).toBe("/zh/encyclopedia/");
    expect(zh.title).toBe("周防桃子");
    expect(zh.body).toContain("傲气？逞强？娇小又倔强的妹妹系偶像！");
    expect(zh.body).toContain("765事务所");

    const en = rows.find((r: SearchRow) => r.lang === "en")!;
    expect(en.path).toBe("/en/encyclopedia/");
    expect(en.title).toBe("Momoko Suou");
    expect(en.body).toContain("Cheeky? Putting on a brave front? A petite, stubborn little-sister-style idol!");
    expect(en.body).toContain("Keiko Watanabe");

    // Deterministic: same input → identical serialization.
    const a = JSON.stringify(buildProfileSearchIndex(profiles));
    const b = JSON.stringify(buildProfileSearchIndex(profiles));
    expect(a).toBe(b);

    // Profile rows must not carry internal editorial ids at all: the typed
    // fields are undefined and the serialized row omits them entirely.
    for (const row of rows) {
      expect(JSON.stringify(row)).not.toContain("sourceId");
      expect(JSON.stringify(row)).not.toContain("sourceItemId");
      expect(row.sourceId).toBeUndefined();
      expect(row.sourceItemId).toBeUndefined();
      // No internal editorial tokens in profile rows.
      expect(JSON.stringify(row)).not.toContain("S7");
      expect(JSON.stringify(row)).not.toContain("@tsundere");
      expect(JSON.stringify(row)).not.toContain("review_status");
      expect(JSON.stringify(row)).not.toContain("T1");
    }
  });

  it("produces no rows from draft or retracted profiles (current-reviewed gate is internal)", async () => {
    useSyntheticRoot();
    const { buildProfileSearchIndex } = await import("../src/lib/search.ts");
    const all = loadProfiles();
    // draft-profile and retracted-profile (synthetic) are not current-reviewed.
    const nonPublished = all.filter((p) => p.canonical.reviewStatus !== "reviewed");
    const rows = buildProfileSearchIndex(nonPublished);
    expect(rows).toHaveLength(0);
    // Mixed input still only emits the current-reviewed profile (synthetic momoko-suou).
    expect(buildProfileSearchIndex(all)).toHaveLength(3);
  });
});
