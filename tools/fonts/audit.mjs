// Artifact audit for self-hosted fonts (task #25).
// Fails closed if: any public/fonts file is not in the manifest, any file is
// not a woff2, or any CSS references an external URL (runtime CDN).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FONTS_DIR = path.join(ROOT, "public/fonts");
const manifestPath = path.join(FONTS_DIR, "manifest.json");

function main() {
  if (!fs.existsSync(manifestPath)) {
    throw new Error("font manifest missing; run tools/fonts/subset.mjs first");
  }
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const allowed = new Set();
  for (const locale of Object.values(manifest.locales)) {
    for (const f of locale.files) allowed.add(f);
  }
  const onDisk = fs.readdirSync(FONTS_DIR).filter((f) => f !== "manifest.json");
  for (const f of onDisk) {
    if (!allowed.has(f)) {
      throw new Error(`unexpected font artifact: ${f}`);
    }
    if (!f.endsWith(".woff2")) {
      throw new Error(`non-woff2 artifact: ${f}`);
    }
  }
  // No external URL references in the generated CSS.
  const cssPath = path.join(ROOT, "src/styles/fonts.css");
  const css = fs.readFileSync(cssPath, "utf8");
  const external = css.match(/url\((?![^)]*\/fonts\/)[^)]*\)/g) || [];
  if (external.length) {
    throw new Error(`external font URL in fonts.css: ${external.join(", ")}`);
  }
  console.log(`[fonts] audit ok: ${onDisk.length} woff2 artifacts, no external URLs`);
}

main();
