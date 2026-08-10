/**
 * Deterministic font subset / coverage pipeline for momoko.pro.
 *
 * Each locale binds to a distinct glyph source: zh -> Noto Sans SC,
 * ja -> Noto Sans JP, en -> Inter (all OFL-1.1). @fontsource ships these as
 * per-locale unicode-range slices; this module verifies that the required
 * character corpus (UI messages + reviewed content package) is fully covered
 * by the locale source, and emits a manifest of the self-hosted WOFF2 files.
 *
 * Fail-closed: if a required character is missing from the locale font, the
 * build must fail rather than silently falling back to another region's
 * glyphs.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

export interface LocaleFontSpec {
  locale: string;
  family: string;
  /** @fontsource package name */
  package: string;
  /** locale CSS file within the package (e.g. chinese-simplified-400.css) */
  cssFile: string;
  /** weight used by the site */
  weight: number;
}

export const LOCALE_FONTS: LocaleFontSpec[] = [
  {
    locale: "zh",
    family: "Noto Sans SC",
    package: "noto-sans-sc",
    cssFile: "chinese-simplified-400.css",
    weight: 400,
  },
  {
    locale: "ja",
    family: "Noto Sans JP",
    package: "noto-sans-jp",
    cssFile: "japanese-400.css",
    weight: 400,
  },
  {
    locale: "en",
    family: "Inter",
    package: "inter",
    cssFile: "latin-400.css",
    weight: 400,
  },
];

export function localeFont(locale: string): LocaleFontSpec {
  const spec = LOCALE_FONTS.find((item) => item.locale === locale);
  if (!spec) throw new Error(`unsupported locale: ${locale}`);
  return spec;
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

/** Collect every unique character from the UI messages for a locale. */
export function messageChars(locale: string): Set<string> {
  const messagesFile = path.resolve(
    __dirname,
    `../../messages/${locale}.json`,
  );
  const messages = readJson(messagesFile);
  const chars = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") {
      for (const ch of value) chars.add(ch);
    } else if (Array.isArray(value)) {
      value.forEach(walk);
    } else if (value && typeof value === "object") {
      Object.values(value).forEach(walk);
    }
  };
  walk(messages);
  return chars;
}

/** Collect every unique character from the reviewed content package. */
export function contentChars(): Set<string> {
  const chars = new Set<string>();
  const roots = [
    path.resolve(__dirname, "../../tests/fixtures/content-package"),
  ];
  const seen = new Set<string>();
  const visit = (p: string): void => {
    let stat;
    try {
      stat = fs.statSync(p);
    } catch {
      return;
    }
    if (stat.isDirectory()) {
      for (const entry of fs.readdirSync(p)) visit(path.join(p, entry));
      return;
    }
    if (!/\.(json|md|txt)$/.test(p)) return;
    const key = path.resolve(p);
    if (seen.has(key)) return;
    seen.add(key);
    const raw = fs.readFileSync(p, "utf8");
    for (const ch of raw) chars.add(ch);
  };
  for (const root of roots) visit(root);
  return chars;
}

/** Union of UI messages + content for a locale (locale text is locale-scoped). */
export function requiredChars(locale = "zh"): Set<string> {
  const chars = new Set<string>();
  for (const ch of messageChars(locale)) chars.add(ch);
  for (const ch of contentChars()) chars.add(ch);
  return chars;
}

interface Slice {
  url: string;
  unicodeRanges: Array<[number, number]>;
}

function parseRanges(spec: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  for (const part of spec.split(",")) {
    const clean = part.trim();
    if (!clean) continue;
    const [a, b] = clean.split("-");
    if (a === undefined) continue;
    const start = parseInt(a.replace("U+", ""), 16);
    const end = b ? parseInt(b.replace("U+", ""), 16) : start;
    ranges.push([start, end]);
  }
  return ranges;
}

/** Parse a @fontsource locale CSS file into its woff2 slices + ranges. */
export function parseFontCss(css: string): Slice[] {
  const slices: Slice[] = [];
  const blocks = css.split("@font-face");
  for (const block of blocks) {
    const urlMatch = block.match(/url\(([^)]+\.woff2)\)/);
    const rangeMatch = block.match(/unicode-range:\s*([^;]+);/);
    if (!urlMatch || !urlMatch[1]) continue;
    slices.push({
      url: urlMatch[1].replace(/["']/g, ""),
      unicodeRanges: rangeMatch && rangeMatch[1] ? parseRanges(rangeMatch[1]) : [],
    });
  }
  return slices;
}

/** Combine the family base (Latin/Common) with a locale CJK slice CSS. */
function familySlices(fontRoot: string, spec: LocaleFontSpec): Slice[] {
  const packageDir = path.resolve(fontRoot, spec.package);
  const base = fs.readFileSync(path.join(packageDir, "400.css"), "utf8");
  const locale = fs.readFileSync(path.join(packageDir, spec.cssFile), "utf8");
  return [...parseFontCss(base), ...parseFontCss(locale)];
}

/** Check that every required character is covered by the locale font slices. */
export async function checkCoverage(
  locale: string,
  chars: Set<string>,
  fontRoot: string,
): Promise<{ missing: string[]; covered: number }> {
  const spec = localeFont(locale);
  const slices = familySlices(fontRoot, spec);
  const missing: string[] = [];
  for (const ch of chars) {
    const code = ch.codePointAt(0);
    if (code === undefined) continue;
    const covered = slices.some((slice) =>
      slice.unicodeRanges.some(([start, end]) => code >= start && code <= end),
    );
    if (!covered) missing.push(ch);
  }
  return { missing, covered: chars.size - missing.length };
}

/** Build the per-locale manifest (files, ranges, version, sha256). */
export async function buildManifest(
  fontRoot: string,
): Promise<{ locales: Record<string, { files: string[]; ranges: string[]; sha256: string }> }> {
  const locales: Record<string, { files: string[]; ranges: string[]; sha256: string }> = {};
  for (const spec of LOCALE_FONTS) {
    const packageDir = path.resolve(fontRoot, spec.package);
    const slices = familySlices(fontRoot, spec);
    const files: string[] = [];
    const ranges: string[] = [];
    const hashes: string[] = [];
    for (const slice of slices) {
      const url = slice.url.replace(/^\.\//, "");
      const filePath = path.join(packageDir, url);
      const buf = fs.readFileSync(filePath);
      hashes.push(crypto.createHash("sha256").update(buf).digest("hex"));
      files.push(url);
      ranges.push(
        slice.unicodeRanges.map(([a, b]) => (a === b ? `U+${a.toString(16)}` : `U+${a.toString(16)}-${b.toString(16)}`)).join(","),
      );
    }
    locales[spec.locale] = {
      files,
      ranges,
      sha256: crypto.createHash("sha256").update(hashes.join("|")).digest("hex"),
    };
  }
  return { locales };
}
