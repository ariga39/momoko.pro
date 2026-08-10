// Public-build artifact audit. Verifies the public output contains only
// reviewed/current content: no draft/stale/retracted detail/body, and scans for
// controlled secret patterns / raw schema markers (reports categories only,
// never matched values).
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

  // 1) Forbidden content markers (retracted/draft/stale detail paths and
  // synthetic/demo material that must stay in explicit test packages).
  const forbiddenPath = /synth-2026-08-08-00(2|3)/;
  const forbiddenDemo = /synthetic|合成夹具|demo news|fake news/i;
  const forbiddenMediaPath = /\.(?:png|jpe?g|gif|webp|mp3|wav|ogg|m4a|flac|mp4|webm)$/i;
  const forbiddenRuntimePath = /(?:^|[/._-])(?:crawler|cron|deploy|maintenance|research)(?:[/._-]|$)/i;
  // 2) Controlled raw/secret-shaped markers: we never place real values in the
  //    output, only detect suspicious shapes.
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
    if (forbiddenMediaPath.test(rel)) {
      problems.push(`copyrighted-media-shaped file in public build: ${rel}`);
    }
    if (/\.svg$/i.test(rel)) {
      const artifactRel = path.relative(dist, f);
      if (artifactRel !== "momoko-logo.svg") problems.push(`unapproved SVG asset in public build: ${rel}`);
      const svg = fs.readFileSync(f, "utf-8");
      if (!svg.includes('viewBox="0 0 1200 220"')) problems.push(`logo viewBox mismatch in ${rel}`);
      if (!svg.includes("LibreBaskerville-OFL.txt") || !svg.includes("Nunito-OFL.txt")) {
        problems.push(`logo attribution metadata missing in ${rel}`);
      }
      if (/<(?:image|audio|video)\b/i.test(svg) || /(?:href|src)=["']https?:/i.test(svg)) {
        problems.push(`external/media reference in ${rel}`);
      }
    }
    if (forbiddenRuntimePath.test(rel)) {
      problems.push(`research/maintenance runtime path in public build: ${rel}`);
    }
    if (!/\.(html|json|css|js)$/.test(f)) continue;
    const text = fs.readFileSync(f, "utf-8");
    if (forbiddenPath.test(text)) {
      problems.push(`forbidden content marker in ${rel}`);
    }
    if (forbiddenDemo.test(text)) {
      problems.push(`synthetic/demo marker in ${rel}`);
    }
    if (/<script[^>]+src=["']https?:\/\//i.test(text)) {
      problems.push(`external script in ${rel}`);
    }
    if (/fonts\.googleapis|fonts\.gstatic|@font-face|https?:\/\/[^\s"']+\.(?:woff2?|ttf|otf)\b/i.test(text)) {
      problems.push(`external font reference in ${rel}`);
    }
    if (/<(?:audio|video|source)\b/i.test(text)) {
      problems.push(`media markup in ${rel}`);
    }
    for (const match of text.matchAll(/<img\b[^>]*>/gi)) {
      if (!/src=["']\/momoko-logo\.svg["']/i.test(match[0])) {
        problems.push(`unapproved image markup in ${rel}`);
      }
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
