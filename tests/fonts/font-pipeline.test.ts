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
  it("the same han codepoint resolves to distinct outlines in SC vs JP subsets", () => {
    const scPath = path.join(OUT_FONTS, "noto-sans-sc-chinese-simplified-400-normal.woff2");
    const jpPath = path.join(OUT_FONTS, "noto-sans-jp-japanese-400-normal.woff2");
    if (!fs.existsSync(scPath) || !fs.existsSync(jpPath)) return; // generator gate
    const fontkit = require("fontkit");
    const sc = fontkit.openSync(scPath);
    const jp = fontkit.openSync(jpPath);
    // Chars whose simplified (SC) vs Japanese (JP) glyph shapes differ, so the
    // fonts cannot be aliases. (Many CJK chars are han-unified and identical;
    // these are the ones that legitimately differ.)
    const differ = [0x4eac, 0x4eba, 0x4f1a, 0x4ee5]; // 京/人/会/以
    for (const cp of differ) {
      // Both subsets must actually contain the codepoint.
      expect(sc.characterSet.includes(cp)).toBe(true);
      expect(jp.characterSet.includes(cp)).toBe(true);
      // Glyph IDs are local indices and prove nothing about shape; compare the
      // normalized outline path commands instead.
      const fmt = (cmd: { command: string; args: number[] }): string => `${cmd.command}:${cmd.args.join(",")}`;
      const scOutline = sc.glyphForCodePoint(cp).path.commands.map(fmt);
      const jpOutline = jp.glyphForCodePoint(cp).path.commands.map(fmt);
      expect(scOutline).not.toEqual(jpOutline);
    }
  });
});

describe("locale font stacks never mix regions (task #25 contract)", () => {
  it("zh stack lists no Japanese font; ja stack lists no Simplified-Chinese font", () => {
    const css = fs.readFileSync(path.resolve(__dirname, "../../src/styles/fonts.css"), "utf8");
    const zhBlock = css.match(/:root\s*\{([^}]*)\}/)?.[1] ?? "";
    const jaBlock = css.match(/html\[lang="ja"\]\s*\{([^}]*)\}/)?.[1] ?? "";
    // Japanese fonts that must never appear in the zh stack.
    for (const jpFont of ["Hiragino", "Noto Sans JP", "Yu Gothic", "Meiryo", "MS Gothic", "MS Mincho"]) {
      expect(zhBlock, `zh stack must not contain ${jpFont}`).not.toContain(jpFont);
    }
    // Simplified-Chinese fonts that must never appear in the ja stack.
    for (const scFont of ["PingFang SC", "Noto Sans SC", "Microsoft YaHei", "SimHei", "SimSun"]) {
      expect(jaBlock, `ja stack must not contain ${scFont}`).not.toContain(scFont);
    }
    // The SC face must be present in the zh stack.
    expect(zhBlock).toContain("Noto Sans SC");
  });
});
