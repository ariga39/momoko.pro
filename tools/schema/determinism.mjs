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

function remove(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function build(outDir) {
  remove(outDir);
  execFileSync("pnpm", ["exec", "astro", "build", "--outDir", outDir], {
    cwd: REPO_ROOT,
    stdio: "inherit",
  });
  // postbuild artifacts live under dist/; replicate into outDir
  execFileSync(
    "node",
    ["--experimental-strip-types", "tools/schema/postbuild.ts"],
    { cwd: REPO_ROOT, stdio: "inherit" },
  );
  if (outDir !== path.join(REPO_ROOT, "dist")) {
    fs.cpSync(path.join(REPO_ROOT, "dist"), outDir, { recursive: true });
  }
}

function snapshot(dir) {
  const out = {};
  const walk = (d, prefix) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const full = path.join(d, entry.name);
      const rel = path.posix.join(prefix, entry.name);
      if (entry.isDirectory()) walk(full, rel);
      else if (entry.isFile()) out[rel] = crypto.createHash("sha256").update(fs.readFileSync(full)).digest("hex");
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
