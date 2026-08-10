// Generate the committed source lock (tools/fonts/source-lock.json) that pins
// every @fontsource input shard SHA-256, LICENSE SHA-256, and package version
// actually selected by the subset build. This lock is independent of the
// generated public/fonts output: it is the frozen, reviewable trust anchor that
// both the generator (before subsetting) and the audit verify against the real
// node_modules files.
import fs from "node:fs";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const FONTROOT = path.join(ROOT, "node_modules/@fontsource");
const LOCK_PATH = path.join(__dirname, "source-lock.json");

const FAMILIES = {
  zh: { package: "noto-sans-sc", css: ["400.css", "chinese-simplified-400.css"] },
  ja: { package: "noto-sans-jp", css: ["400.css", "japanese-400.css"] },
  en: { package: "inter", css: ["400.css", "latin-400.css"] },
};

function sha256(p) {
  return crypto.createHash("sha256").update(fs.readFileSync(p)).digest("hex");
}

function collectShards(pkg, cssFiles) {
  const out = new Set();
  for (const css of cssFiles) {
    const cssPath = path.join(FONTROOT, pkg, css);
    if (!fs.existsSync(cssPath)) continue;
    const text = fs.readFileSync(cssPath, "utf8");
    for (const m of text.matchAll(/url\(\.\/files\/([^)]+\.woff2)\)/g)) {
      out.add(m[1]);
    }
  }
  return [...out].sort();
}

function main() {
  const packages = {};
  for (const spec of Object.values(FAMILIES)) {
    const pkg = spec.package;
    const pkgJson = JSON.parse(fs.readFileSync(path.join(FONTROOT, pkg, "package.json"), "utf8"));
    const shards = {};
    for (const shard of collectShards(pkg, spec.css)) {
      shards[shard] = sha256(path.join(FONTROOT, pkg, "files", shard));
    }
    packages[pkg] = {
      version: String(pkgJson.version),
      license_sha256: sha256(path.join(FONTROOT, pkg, "LICENSE")),
      shards,
    };
  }
  const lock = {
    schema_version: "1",
    generated_by: "tools/fonts/lock-source.mjs",
    note:
      "Trusted pinned hashes of every @fontsource input shard, LICENSE text, and package version actually selected by the subset build. This file is committed for review and is independent of the generated public/fonts output. Generate with pnpm fonts:lock-source.",
    packages,
  };
  fs.writeFileSync(LOCK_PATH, JSON.stringify(lock, null, 2) + "\n");
  console.log(`[fonts] source lock written: ${LOCK_PATH}`);
}

main();
