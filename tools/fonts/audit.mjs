// Artifact audit for self-hosted fonts (task #25).
// Fails closed if: the shipped total exceeds the <1MB budget, any public/fonts
// file is not in the manifest, any file is not a woff2, any manifest byte/sha
// mismatches the on-disk artifact, or any CSS references an external URL.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FONTS_DIR = path.join(ROOT, "public/fonts");
const manifestPath = path.join(FONTS_DIR, "manifest.json");
const BUDGET_BYTES = 1_000_000;

function sha256File(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function main() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error("font manifest missing; run pnpm fonts:subset first");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  if (typeof manifest.budget_bytes !== "number" || manifest.budget_bytes !== BUDGET_BYTES) {
    throw new Error(`font manifest budget mismatch: expected ${BUDGET_BYTES}`);
  }

  const declared = new Map(); // filename -> {bytes, sha256}
  for (const entry of Object.values(manifest.locales)) {
    for (const f of entry.files) declared.set(f.file, f);
  }

  const onDisk = fs.readdirSync(FONTS_DIR).filter((f) => f !== "manifest.json");
  for (const f of onDisk) {
    if (!declared.has(f)) {
      throw new Error(`unexpected font artifact: ${f}`);
    }
    if (!f.endsWith(".woff2")) {
      throw new Error(`non-woff2 artifact: ${f}`);
    }
    const meta = declared.get(f);
    const full = path.join(FONTS_DIR, f);
    const size = fs.statSync(full).size;
    if (size !== meta.bytes) {
      throw new Error(`font byte mismatch ${f}: disk=${size} manifest=${meta.bytes}`);
    }
    if (sha256File(full) !== meta.sha256) {
      throw new Error(`font sha256 mismatch ${f}`);
    }
  }

  // Hard budget: shipped webfont bytes must be strictly < 1,000,000.
  const total = manifest.total_bytes ?? onDisk.reduce((sum, f) => sum + fs.statSync(path.join(FONTS_DIR, f)).size, 0);
  if (total >= BUDGET_BYTES) {
    throw new Error(`shipped webfont ${total}B exceeds budget ${BUDGET_BYTES}B`);
  }

  // No external URL references in the generated CSS.
  const cssPath = path.join(ROOT, "src/styles/fonts.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const external = css.match(/url\((?![^)]*\/fonts\/)[^)]*\)/g) || [];
  if (external.length) {
    throw new Error(`external font URL in fonts.css: ${external.join(", ")}`);
  }

  console.log(
    `[fonts] audit ok: ${onDisk.length} woff2 artifacts, ${total}B total (< ${BUDGET_BYTES}B), no external URLs`,
  );
}

main();
