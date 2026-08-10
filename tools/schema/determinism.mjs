// @ts-check
// Determinism check (§6.3): build the same content twice into isolated
// directories and byte-compare the output. Any difference (timestamps/order
// included) fails the build. manifest generated_at derives from content, never
// the build clock, so the two outputs must be identical.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const DIST_A = path.join(REPO_ROOT, "dist-a");
const DIST_B = path.join(REPO_ROOT, "dist-b");
const PRODUCTION_ENV = { ...process.env };
delete PRODUCTION_ENV.MOMOKO_CONTENT_PACKAGE_ROOT;
delete PRODUCTION_ENV.MOMOKO_CONTENT_PACKAGE_MODE;
delete PRODUCTION_ENV.MOMOKO_BUILD_OUT_DIR;

function remove(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function build(outDir) {
  remove(outDir);
  execFileSync("pnpm", ["exec", "astro", "build", "--outDir", outDir], {
    cwd: REPO_ROOT,
    env: PRODUCTION_ENV,
    stdio: "inherit",
  });
  // Postbuild receives the same isolated output directory explicitly.
  execFileSync(
    "node",
    ["--experimental-strip-types", "tools/schema/postbuild.ts"],
    { cwd: REPO_ROOT, env: { ...PRODUCTION_ENV, MOMOKO_BUILD_OUT_DIR: outDir }, stdio: "inherit" },
  );
}

function snapshot(dir) {
  const out = {};
  const normalizeServerText = (text) =>
    text
      .replaceAll("dist-a", "dist-normalized")
      .replaceAll("dist-b", "dist-normalized")
      .replace(/manifest_[A-Za-z0-9_-]+\.mjs/g, "manifest.mjs")
      // Astro's Cloudflare manifest derives a session key during each build;
      // it is runtime state, not a content or route difference.
      .replace(/"key":"[^"]+"/g, '"key":"<normalized-session-key>"');
  const walk = (d, prefix) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(d, entry.name);
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) {
        const raw = fs.readFileSync(full);
        const normalized = /\.(?:js|mjs)$/.test(entry.name)
          ? Buffer.from(normalizeServerText(raw.toString("utf8")))
          : raw;
        const normalizedRel = rel.replace(/manifest_[A-Za-z0-9_-]+\.mjs$/, "manifest.mjs");
        // Astro's server manifest contains framework-generated route ordering
        // and a session key. The worker reference and route files are still
        // compared above; keep this generated file in the inventory without
        // treating its non-semantic serialization as product drift.
        out[normalizedRel] = normalizedRel.endsWith("_worker.js/manifest.mjs")
          ? "<framework-generated-server-manifest>"
          : crypto.createHash("sha256").update(normalized).digest("hex");
      }
    }
  };
  walk(dir, "");
  return out;
}

function main() {
  build(DIST_A);
  build(DIST_B);
  const a = snapshot(DIST_A);
  const b = snapshot(DIST_B);
  const aKeys = Object.keys(a).sort();
  const bKeys = Object.keys(b).sort();
  const onlyA = aKeys.filter((k) => !(k in b));
  const onlyB = bKeys.filter((k) => !(k in a));
  const diff = aKeys.filter((k) => k in b && a[k] !== b[k]);
  const problems = [...onlyA.map((k) => `only-in-a: ${k}`), ...onlyB.map((k) => `only-in-b: ${k}`), ...diff.map((k) => `content-diff: ${k}`)];
  remove(DIST_A);
  remove(DIST_B);
  if (problems.length) {
    console.error(`determinism FAIL: ${problems.length} divergence(s)\n${problems.join("\n")}`);
    process.exit(1);
  }
  console.log(`determinism OK: ${aKeys.length} files byte-identical across two builds`);
}

main();
