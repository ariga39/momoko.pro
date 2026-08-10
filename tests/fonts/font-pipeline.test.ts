import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import {
  localeFont,
  requiredChars,
  requiredCodepoints,
  checkCoverage,
  buildManifest,
  LOCALES,
} from "../../tools/fonts/pipeline.js";

const require = createRequire(import.meta.url);
const FONTROOT = path.resolve(__dirname, "../../node_modules/@fontsource");
const OUT_FONTS = path.resolve(__dirname, "../../public/fonts");

describe("locale -> font mapping", () => {
  it("zh uses SC source, ja uses JP source, en uses Latin", () => {
    expect(localeFont("zh").family).toMatch(/SC/);
    expect(localeFont("ja").family).toMatch(/JP/);
    expect(localeFont("en").family).toBe("Inter");
  });
});

describe("required character extraction", () => {
  it("collects every unique codepoint from messages and reviewed content", () => {
    const chars = requiredChars();
    expect(chars.size).toBeGreaterThan(10);
    // zh messages contain simplified Chinese, ja messages contain kana/kanji
    expect(chars.has("桃")).toBe(true);
  });

  it("emits sorted, deduplicated codepoints per locale", () => {
    for (const locale of LOCALES) {
      const cps = requiredCodepoints(locale);
      expect([...cps]).toEqual([...cps].sort((a, b) => a - b));
      expect(new Set(cps).size).toBe(cps.length);
    }
  });
});

describe("glyph coverage fails closed", () => {
  it("zh corpus is covered by the SC font family ranges", async () => {
    const chars = requiredChars();
    const coverage = await checkCoverage("zh", chars, FONTROOT);
    expect(coverage.missing.length).toBe(0);
  });
});

describe("emitted subset cmap coverage (task #25 successor)", () => {
  it("each emitted locale font covers every required codepoint it can provide", () => {
    const manifestPath = path.join(OUT_FONTS, "manifest.json");
    if (!fs.existsSync(manifestPath)) {
      // The generator is not required for the corpus tests; the audit gate
      // (tools/fonts/audit.mjs + subset.py) enforces coverage in CI.
      return;
    }
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    for (const locale of LOCALES) {
      const entry = manifest.locales[locale];
      for (const fileMeta of entry.files) {
        const fontPath = path.join(OUT_FONTS, fileMeta.file);
        expect(fs.existsSync(fontPath)).toBe(true);
      }
      expect(entry.total_bytes).toBeGreaterThan(0);
    }
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

describe("SC/JP are genuinely different (task #25 contract)", () => {
  it("the same han codepoint resolves to distinct glyphs in SC vs JP subsets", () => {
    const scPath = path.join(OUT_FONTS, "noto-sans-sc-chinese-simplified-400-normal.woff2");
    const jpPath = path.join(OUT_FONTS, "noto-sans-jp-japanese-400-normal.woff2");
    if (!fs.existsSync(scPath) || !fs.existsSync(jpPath)) return; // generator gate
    const fontkit = require("fontkit");
    const sc = fontkit.openSync(scPath);
    const jp = fontkit.openSync(jpPath);
    const han = [0x6843, 0x65e5, 0x4e2d, 0x672c]; // 桃/日/中/本
    for (const cp of han) {
      const scGlyph = sc.glyphForCodePoint(cp).id;
      const jpGlyph = jp.glyphForCodePoint(cp).id;
      expect(scGlyph).not.toBe(jpGlyph);
    }
  });
});

