// Artifact audit for self-hosted fonts (task #25).
// Fails closed if:
//  - any public/fonts file is not in the manifest or vice versa;
//  - any file is not a woff2 or its byte/sha256 mismatches the manifest;
//  - the shipped total reaches the <1MB budget;
//  - the manifest <-> fonts.css @font-face mapping is not bidirectional;
//  - any required codepoint the family provides is unreachable from CSS cmap
//    (the recorded foreign/system-fallback allowlist is the only exception);
//  - any CSS references an external URL.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FONTS_DIR = path.join(ROOT, "public/fonts");
const manifestPath = path.join(FONTS_DIR, "manifest.json");
const CSS_PATH = path.join(ROOT, "src/styles/fonts.css");
const CORPUS_PATH = path.join(ROOT, "node_modules/.cache/momoko-font-corpus.json");
const BUDGET_BYTES = 1_000_000;

const require = createRequire(import.meta.url);
const fontkit = require("fontkit");

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function parseRanges(spec) {
  const out = [];
  for (const part of spec.split(",")) {
    const clean = part.trim();
    if (!clean) continue;
    const m = clean.match(/^U\+([0-9A-Fa-f]+)(?:-([0-9A-Fa-f]+))?$/);
    if (!m) throw new Error(`malformed unicode-range: ${clean}`);
    const a = parseInt(m[1], 16);
    const b = m[2] ? parseInt(m[2], 16) : a;
    out.push([a, b]);
  }
  return out;
}

function cmapOf(p) {
  try {
    return new Set(fontkit.openSync(p).characterSet);
  } catch {
    throw new Error(`cannot read font cmap: ${p}`);
  }
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error("font manifest missing; run pnpm fonts:subset first");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (typeof manifest.budget_bytes !== "number" || manifest.budget_bytes !== BUDGET_BYTES) {
    throw new Error(`font manifest budget mismatch: expected ${BUDGET_BYTES}`);
  }
  const corpus = JSON.parse(fs.readFileSync(CORPUS_PATH, "utf8"));

  const declared = new Map(); // filename -> entry
  for (const entry of Object.values(manifest.locales)) {
    for (const f of entry.files) declared.set(f.file, f);
  }

  // 1. Disk <-> manifest closure.
  const onDisk = fs.readdirSync(FONTS_DIR).filter((f) => f !== "manifest.json");
  for (const f of onDisk) {
    if (!declared.has(f)) throw new Error(`unexpected font artifact: ${f}`);
    if (!f.endsWith(".woff2")) throw new Error(`non-woff2 artifact: ${f}`);
    const meta = declared.get(f);
    const full = path.join(FONTS_DIR, f);
    if (fs.statSync(full).size !== meta.bytes) throw new Error(`font byte mismatch ${f}`);
    if (sha256File(full) !== meta.sha256) throw new Error(`font sha256 mismatch ${f}`);
  }
  for (const f of declared.keys()) {
    if (!onDisk.includes(f)) throw new Error(`manifest file missing on disk: ${f}`);
  }

  // 2. Manifest <-> fonts.css bidirectional mapping.
  const cssText = fs.readFileSync(CSS_PATH, "utf8");
  const cssFiles = new Set(
    [...cssText.matchAll(/url\("\/fonts\/([^")]+\.woff2)"\)/g)].map((m) => m[1]),
  );
  for (const f of declared.keys()) {
    if (!cssFiles.has(f)) throw new Error(`manifest file not referenced in fonts.css: ${f}`);
  }
  for (const f of cssFiles) {
    if (!declared.has(f)) throw new Error(`fonts.css references unknown font: ${f}`);
  }

  // 3. CSS-reachable cmap must cover every required codepoint the family
  //    provides; the recorded foreign/system-fallback allowlist is the only
  //    acceptable omission.
  const locFamily = { zh: "Noto Sans SC", ja: "Noto Sans JP", en: "Inter" };
  for (const locale of Object.keys(locFamily)) {
    const family = locFamily[locale];
    const entry = manifest.locales[locale];
    const required = new Set(corpus[locale] ?? []);
    const foreign = new Set(entry.foreign_codepoints ?? []);

    // Parse @font-face blocks for this family: each block's unicode-range and file.
    const blocks = cssText.split("@font-face").filter((b) => b.includes(`font-family: "${family}"`));
    const reachable = new Set();
    for (const blk of blocks) {
      const m = blk.match(/url\("\/fonts\/([^"]+\.woff2)"\)/);
      const r = blk.match(/unicode-range:\s*([^;]+);/);
      if (!m || !r) throw new Error(`invalid @font-face block for ${family}`);
      const file = m[1];
      const cmap = cmapOf(path.join(FONTS_DIR, file));
      for (const [a, b] of parseRanges(r[1])) {
        for (const cp of required) {
          if (cp >= a && cp <= b && cmap.has(cp)) reachable.add(cp);
        }
      }
    }
    const unreachable = [...required].filter((cp) => !reachable.has(cp));
    // Every unreachable required cp must be in the recorded system-fallback list.
    const illegal = unreachable.filter((cp) => !foreign.has(cp));
    if (illegal.length) {
      const sample = illegal.slice(0, 10).map((c) => `U+${c.toString(16).toUpperCase()} ${String.fromCodePoint(c)}`).join(", ");
      throw new Error(`locale ${locale}: ${illegal.length} required codepoints unreachable via CSS cmap: ${sample}`);
    }
  }

  // 4. Hard budget.
  const total = manifest.total_bytes ?? onDisk.reduce((s, f) => s + fs.statSync(path.join(FONTS_DIR, f)).size, 0);
  if (total >= BUDGET_BYTES) {
    throw new Error(`shipped webfont ${total}B exceeds budget ${BUDGET_BYTES}B`);
  }

  // 5. No external URLs in the generated CSS.
  const external = cssText.match(/url\((?![^)]*\/fonts\/)[^)]*\)/g) || [];
  if (external.length) throw new Error(`external font URL in fonts.css: ${external.join(", ")}`);

  console.log(
    `[fonts] audit ok: ${onDisk.length} woff2 artifacts, ${total}B total (< ${BUDGET_BYTES}B), ` +
      `manifest<->css closed, css-reachable cmap 0 missing (system fallback allowlist only)`,
  );
}

main();
