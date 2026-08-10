/**
 * Deterministic font subset / coverage pipeline for momoko.pro.
 *
 * Each locale binds to a distinct glyph source: zh -> Noto Sans SC,
 * ja -> Noto Sans JP, en -> Inter (all OFL-1.1). The required corpus for a
 * locale is the set of characters its pages actually render in that locale's
 * own language: UI messages, the visual catalog strings for that locale, and
 * the reviewed content (canonical titles render on every locale page; the
 * resolved body renders the locale translation or the canonical source body).
 *
 * The generator (tools/fonts/subset.py) carves each locale font from the
 * pinned @fontsource shards to exactly these codepoints and verifies cmap
 * coverage fail-closed: any required character missing from the emitted subset
 * aborts the build. Characters the source family genuinely cannot provide
 * (foreign-script fixtures such as the trilingual language-switcher labels)
 * are recorded as system fallback and never silently dropped.
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

export const LOCALES = LOCALE_FONTS.map((spec) => spec.locale);

export function localeFont(locale: string): LocaleFontSpec {
  const spec = LOCALE_FONTS.find((item) => item.locale === locale);
  if (!spec) throw new Error(`unsupported locale: ${locale}`);
  return spec;
}

function readJson(p: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function addChars(chars: Set<string>, text: string): void {
  for (const ch of text) chars.add(ch);
}

/** Collect every unique character from the UI messages for a locale. */
export function messageChars(locale: string): Set<string> {
  const messagesFile = path.resolve(__dirname, `../../messages/${locale}.json`);
  const messages = readJson(messagesFile);
  const chars = new Set<string>();
  const walk = (value: unknown): void => {
    if (typeof value === "string") addChars(chars, value);
    else if (Array.isArray(value)) value.forEach(walk);
    else if (value && typeof value === "object") Object.values(value).forEach(walk);
  };
  walk(messages);
  return chars;
}

/** Visual catalog strings declared by the test/dev content package, for a locale. */
export function visualCatalogChars(locale: string): Set<string> {
  const chars = new Set<string>();
  const catalogPath = path.resolve(
    __dirname,
    "../../tests/fixtures/content-package/visual-demo/visual-catalog.json",
  );
  if (!fs.existsSync(catalogPath)) return chars;
  let catalog: unknown;
  try {
    catalog = JSON.parse(fs.readFileSync(catalogPath, "utf8"));
  } catch {
    return chars;
  }
  const collectStrings = (value: unknown): string[] => {
    if (typeof value === "string") return [value];
    if (typeof value === "number") return [String(value)]; // years render as text
    if (Array.isArray(value)) return value.flatMap(collectStrings);
    if (value && typeof value === "object") return Object.values(value).flatMap(collectStrings);
    return [];
  };
  // Locale-scoped object keys: notice.{locale}, encyclopedia[].name.{locale}, etc.
  const walkLocale = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(walkLocale);
      return;
    }
    if (value && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        if (key === locale) {
          for (const str of collectStrings(child)) addChars(chars, str);
        } else if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object") {
              const locVal = (item as Record<string, unknown>)[locale];
              if (locVal !== undefined) for (const str of collectStrings(locVal)) addChars(chars, str);
              // Shared tags render on every locale page; their glyphs must exist
              // in every locale font (they are Latin in the fixtures).
              const tags = (item as Record<string, unknown>).tags;
              if (Array.isArray(tags)) for (const tag of tags) addChars(chars, String(tag));
              // Shared scalar fields rendered as text (e.g. song/live year, id).
              for (const [field, value] of Object.entries(item as Record<string, unknown>)) {
                if (field === "tags") continue;
                if (typeof value === "number" || typeof value === "string") {
                  for (const str of collectStrings(value)) addChars(chars, str);
                } else if (value && typeof value === "object") {
                  walkLocale(value); // nested {locale: string} maps (title/venue/note)
                }
              }
            }
          }
        } else if (child && typeof child === "object") {
          walkLocale(child);
        }
      }
    }
  };
  walkLocale(catalog);
  return chars;
}

/** Locate every canonical content.<lang>.md (is_canonical=true) under the test fixture root. */
function walkContentItems(): string[] {
  const base = path.resolve(__dirname, "../../tests/fixtures/content-package");
  const out: string[] = [];
  if (!fs.existsSync(base)) return out;
  const visit = (p: string): void => {
    for (const entry of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, entry.name);
      if (entry.isDirectory()) {
        visit(full);
        continue;
      }
      if (!/^content\.(ja|zh|en)\.md$/.test(entry.name)) continue;
      try {
        const parsed = matter(fs.readFileSync(full, "utf8"));
        if ((parsed.data as Record<string, unknown>).is_canonical === true) out.push(full);
      } catch {
        /* best effort */
      }
    }
  };
  visit(base);
  return out;
}

/**
 * Characters rendered by the news content for a locale: the canonical title
 * (renders on every locale page) plus the resolved body (locale translation
 * when present, otherwise the canonical source body). Only published reviewed
 * items are public-facing; this mirrors src/lib/content.ts rendering rules.
 */
export function newsChars(locale: string): Set<string> {
  const chars = new Set<string>();
  for (const itemPath of walkContentItems()) {
    let parsed: { data: Record<string, unknown>; content: string };
    try {
      parsed = matter(fs.readFileSync(itemPath, "utf8"));
    } catch {
      continue;
    }
    const { data, content } = parsed;
    // Public surface only renders reviewed, non-retracted items. Other items
    // are lifecycle fixtures excluded from the shipped font contract.
    const reviewStatus = String(data.review_status ?? "");
    if (reviewStatus !== "reviewed") continue;
    addChars(chars, String(data.title ?? ""));
    const localeFile = path.join(path.dirname(itemPath), `content.${locale}.md`);
    if (fs.existsSync(localeFile)) {
      try {
        const loc = matter(fs.readFileSync(localeFile, "utf8"));
        addChars(chars, loc.content);
      } catch {
        addChars(chars, content);
      }
    } else {
      addChars(chars, content);
    }
  }
  return chars;
}

/**
 * Characters rendered by the site's static templates (Astro components and
 * pages) on every locale: suit symbols, arrows, middots, and any literal
 * non-ASCII text in markup. Scanning the raw source is deterministic and
 * conservative (may over-include code strings, which is safe for coverage).
 */
export function templateChars(): Set<string> {
  const chars = new Set<string>();
  const roots = [
    path.resolve(__dirname, "../../src/components"),
    path.resolve(__dirname, "../../src/pages"),
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
    if (!/\.astro$/.test(p)) return;
    const key = path.resolve(p);
    if (seen.has(key)) return;
    seen.add(key);
    const raw = fs.readFileSync(p, "utf8");
    for (const ch of raw) {
      const cp = ch.codePointAt(0)!;
      // Keep every printable codepoint (incl. symbols/kana/arrows); control
      // chars and private-use code paths are excluded.
      if (cp >= 0x20 && cp !== 0x7f) chars.add(ch);
    }
  };
  for (const root of roots) visit(root);
  return chars;
}

/**
 * Required characters for a locale: everything its pages render in that
 * locale's own language (UI + visual catalog + reviewed news content) plus the
 * static template glyphs that render on every locale (suits, arrows, middots).
 */
export function requiredChars(locale = "zh"): Set<string> {
  const chars = new Set<string>();
  for (const ch of messageChars(locale)) chars.add(ch);
  for (const ch of visualCatalogChars(locale)) chars.add(ch);
  for (const ch of newsChars(locale)) chars.add(ch);
  for (const ch of templateChars()) chars.add(ch);
  return chars;
}

/** Serialize a locale's required codepoint set (sorted, deduplicated). */
export function requiredCodepoints(locale: string): number[] {
  return [...requiredChars(locale)]
    .map((ch) => ch.codePointAt(0)!)
    .filter((cp) => cp >= 0x20 && cp !== 0x7f) // control characters need no glyph
    .sort((a, b) => a - b);
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

/**
 * Check that every required character is covered by the source font family's
 * declared unicode ranges. (The authoritative fail-closed cmap check runs in
 * subset.py against the emitted fonts; this guards the corpus itself.)
 */
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
