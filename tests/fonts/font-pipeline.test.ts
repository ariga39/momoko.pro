import { describe, it, expect } from "vitest";
import path from "node:path";
import { localeFont, requiredChars, checkCoverage, buildManifest } from "../../tools/fonts/pipeline.js";

const FONTROOT = path.resolve(__dirname, "../../node_modules/@fontsource");

describe("locale -> font mapping", () => {
  it("zh uses SC source, ja uses JP source, en uses Latin", () => {
    expect(localeFont("zh").family).toMatch(/SC/);
    expect(localeFont("ja").family).toMatch(/JP/);
    expect(localeFont("en").family).toBe("Inter");
  });
});

describe("required character extraction", () => {
  it("collects every unique codepoint from messages and demo content", () => {
    const chars = requiredChars();
    expect(chars.size).toBeGreaterThan(10);
    // zh messages contain simplified Chinese, ja messages contain kana/kanji
    expect(chars.has("桃")).toBe(true);
  });
});

describe("glyph coverage fails closed", () => {
  it("zh corpus is covered by the SC font slice", async () => {
    const chars = requiredChars();
    const coverage = await checkCoverage("zh", chars, FONTROOT);
    expect(coverage.missing.length).toBe(0);
  });
});

describe("subset manifest", () => {
  it("records per-locale files, unicode ranges, versions, and hashes", async () => {
    const manifest = await buildManifest(FONTROOT);
    for (const locale of ["zh", "ja", "en"]) {
      const entry = manifest.locales[locale];
      expect(entry).toBeDefined();
      expect(entry!.files.length).toBeGreaterThan(0);
      expect(entry!.files[0]!).toMatch(/\.woff2$/);
    }
  });
});
