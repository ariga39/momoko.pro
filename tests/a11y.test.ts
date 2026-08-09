import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { contrastRatio, hexToRgb, meetsAa } from "../src/lib/a11y.ts";
import { parseCssTokens, REPO_ROOT } from "../tools/schema/css-tokens.ts";

// Design tokens live in tailwind.config.mjs; these tests lock the a11y
// contract (WCAG AA contrast + reduced-motion) so the config cannot silently
// regress. global.css holds the reduced-motion / skip-link / focus-visible rules.

const globalCss = fs.readFileSync(path.join(REPO_ROOT, "src/styles/global.css"), "utf-8");

describe("color tokens — WCAG AA contrast", () => {
  it("text vs background meets AA (≥4.5:1)", () => {
    const { colors } = parseCssTokens();
    expect(meetsAa(colors.text, colors.bg)).toBe(true);
    expect(meetsAa(colors["text-secondary"], colors.bg)).toBe(true);
    expect(meetsAa(colors.link, colors.bg)).toBe(true);
  });

  it("accent used on light surface keeps AA on text pairs that use it", () => {
    const { colors } = parseCssTokens();
    expect(meetsAa(colors.accent, colors.bg)).toBe(true);
    expect(meetsAa(colors["accent-contrast"], colors.accent)).toBe(true);
  });

  it("contrastRatio is symmetric and bounded", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeGreaterThanOrEqual(21);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    const { colors } = parseCssTokens();
    const r = contrastRatio(colors.text, colors.bg);
    expect(r).toBe(contrastRatio(colors.bg, colors.text));
  });

  it("hexToRgb parses 6-digit hex", () => {
    expect(hexToRgb("#ffffff")).toEqual({ r: 255, g: 255, b: 255 });
    expect(hexToRgb("#000000")).toEqual({ r: 0, g: 0, b: 0 });
    expect(() => hexToRgb("#fff")).toThrow();
  });
});

describe("reduced-motion guard", () => {
  it("global.css disables animation/transition under prefers-reduced-motion", () => {
    expect(globalCss).toMatch(/@media\s*\(prefers-reduced-motion:\s*reduce\)/);
    expect(globalCss).toMatch(/animation:\s*none\s*!important/);
    expect(globalCss).toMatch(/transition:\s*none\s*!important/);
  });
});

describe("skip link + focus-visible", () => {
  it("global.css defines skip-link and visible keyboard focus", () => {
    expect(globalCss).toMatch(/\.skip-link/);
    expect(globalCss).toMatch(/:focus-visible/);
    expect(globalCss).toMatch(/\.skip-link:focus/);
  });
});

describe("Paraglide UI catalog", () => {
  it("messages exist for all three locales with same keys", () => {
    const msgsRoot = path.join(REPO_ROOT, "messages");
    const files = fs.readdirSync(msgsRoot).filter((f) => f.endsWith(".json"));
    expect(files).toEqual(["en.json", "ja.json", "zh.json"].sort());
    const keys = files.map((f) =>
      Object.keys(JSON.parse(fs.readFileSync(path.join(msgsRoot, f), "utf-8"))).filter(
        (k) => !k.startsWith("$"),
      ),
    );
    expect(new Set(keys[0])).toEqual(new Set(keys[1]));
    expect(new Set(keys[1])).toEqual(new Set(keys[2]));
  });

  it("missing-translation messages are explicit (not silent rewrites)", () => {
    const ja = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "messages/ja.json"), "utf-8"),
    );
    expect(ja["news.missingLocale"]).toMatch(/缺译|未翻訳|fallback|回退/i);
  });
});
