// Public-build artifact audit（preview build job 内执行）。
// 验证 dist 只含 reviewed/current：draft/stale/retracted 的 detail/body 不存在；
// 并扫描 controlled secret pattern / raw schema marker（只报类别，不输出匹配值）。
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f, out);
    else if (e.isFile()) out.push(f);
  }
  return out;
}

function main() {
  const distArg = process.argv[2];
  const dist = path.resolve(REPO_ROOT, distArg);
  if (!fs.existsSync(dist)) {
    console.error(`public audit: dist not found: ${dist}`);
    process.exit(1);
  }
  const files = walk(dist);
  const problems = [];

  // 1) 禁止出现的 content 标记（retracted/draft/stale 的 detail 路径）。
  const forbiddenPath = /synth-2026-08-08-00(2|3)/;
  // 2) controlled raw/secret-shaped markers：我们不把真实值放产物，只检测可疑形态。
  const secretShapes = [
    /(sk-|pk-|ghp_|gho_|github_pat_|AKIA|token\s*[:=]\s*[A-Za-z0-9_-]{20,})/,
    /"source_item_id"\s*:\s*"[^"]{1,3}"/, // too-short id = raw marker
  ];

  for (const f of files) {
    const rel = path.relative(REPO_ROOT, f);
    if (forbiddenPath.test(rel)) {
      problems.push(`forbidden draft/stale/retracted path in public build: ${rel}`);
      continue;
    }
    if (!/\.(html|json|css|js)$/.test(f)) continue;
    const text = fs.readFileSync(f, "utf-8");
    if (forbiddenPath.test(text)) {
      problems.push(`forbidden content marker in ${rel}`);
    }
    for (const [i, re] of secretShapes.entries()) {
      if (re.test(text)) {
        problems.push(`secret/raw-shaped value (pattern ${i}) in ${rel}`);
      }
    }
  }

  if (problems.length) {
    console.error(`public audit FAIL: ${problems.length} issue(s)`);
    for (const p of problems) console.error("  - " + p);
    process.exit(1);
  }
  console.log(`public audit OK: ${files.length} files, no draft/stale/retracted, no raw/secret-shaped values`);
}

main();
