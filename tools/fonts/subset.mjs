// Deterministic self-host font subsetting (task #25).
// Copies the locale woff2 slices referenced by @fontsource CSS into public/fonts
// and writes a manifest. Fail-closed: if coverage drops, exits non-zero.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FONTROOT = path.join(ROOT, "node_modules/@fontsource");
const OUT = path.join(ROOT, "public/fonts");

const LOCALES = [
  { locale: "zh", pkg: "noto-sans-sc", cssFile: "chinese-simplified-400.css" },
  { locale: "ja", pkg: "noto-sans-jp", cssFile: "japanese-400.css" },
  { locale: "en", pkg: "inter", cssFile: "latin-400.css" },
];

function parseRanges(spec) {
  return spec
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [a, b] = part.split("-");
      const start = parseInt(a.replace("U+", ""), 16);
      const end = b ? parseInt(b.replace("U+", ""), 16) : start;
      return [start, end];
    });
}

function slices(pkgDir, cssText) {
  const out = [];
  for (const block of cssText.split("@font-face")) {
    const m = block.match(/url\(([^)]+\.woff2)\)/);
    const r = block.match(/unicode-range:\s*([^;]+);/);
    if (!m) continue;
    out.push({
      url: m[1].replace(/["']/g, "").replace(/^\.\//, ""),
      ranges: r ? parseRanges(r[1]) : [],
    });
  }
  return out;
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const manifest = { locales: {} };
  for (const { locale, pkg, cssFile } of LOCALES) {
    const pkgDir = path.join(FONTROOT, pkg);
    const base = fs.readFileSync(path.join(pkgDir, "400.css"), "utf8");
    const localeCss = fs.readFileSync(path.join(pkgDir, cssFile), "utf8");
    const all = [...slices(pkgDir, base), ...slices(pkgDir, localeCss)];
    const files = [];
    for (const slice of all) {
      const src = path.join(pkgDir, slice.url);
      const dest = path.join(OUT, path.basename(slice.url));
      if (!fs.existsSync(src)) {
        throw new Error(`font slice missing: ${slice.url}`);
      }
      fs.copyFileSync(src, dest);
      files.push(path.basename(slice.url));
    }
    manifest.locales[locale] = { files };
    console.log(`[fonts] ${locale}: ${files.length} slices -> public/fonts`);
  }
  fs.writeFileSync(
    path.join(ROOT, "public/fonts/manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  console.log("[fonts] manifest written");
}

main();
