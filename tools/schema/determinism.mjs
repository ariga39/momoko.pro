// @ts-check
// 确定性校验（§6.3）：同一内容构建两次到隔离目录，逐字节比对产物。
// 任何差异（含时间戳/顺序）即构建失败。manifest generated_at 由内容派生，
// 不读构建时钟，因此两次产物必须完全一致。
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
