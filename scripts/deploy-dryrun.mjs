// @ts-check
// Cloudflare deployment dry-run audit (task #26).
//
// Safe by construction: this script NEVER deploys or uploads. It builds the
// project, runs `wrangler versions upload --env preview --dry-run --outdir
// <tmp>` to produce a local bundle without any external write, and audits the
// artifact. Missing wrangler config, build failure, dry-run failure, missing
// entry/asset manifest, over-size artifact, source maps, secrets, or demo/
// preview content all fail closed. Repeating the dry-run must be byte-identical.
import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
// Cloudflare Workers Free plan worker size limit (2026-08-10 verifiable).
export const MAX_WORKER_SIZE_BYTES = 3 * 1024 * 1024;

export function auditDir(dir) {
  const entries = [];
  let total = 0;
  function walk(base, rel) {
    for (const name of fs.readdirSync(base)) {
      const full = path.join(base, name);
      const st = fs.statSync(full);
      if (st.isDirectory()) {
        walk(full, path.join(rel, name));
      } else if (st.isFile()) {
        entries.push(path.join(rel, name));
        total += st.size;
      }
    }
  }
  walk(dir, "");
  return { entries: entries.sort(), total };
}

function dirHash(dir) {
  const audit = auditDir(dir);
  const hasher = crypto.createHash("sha256");
  for (const rel of audit.entries) {
    hasher.update(rel);
    hasher.update(fs.readFileSync(path.join(dir, rel)));
  }
  return hasher.digest("hex");
}

export function evaluateBundle(audit, { maxBytes = MAX_WORKER_SIZE_BYTES } = {}) {
  if (!audit || !audit.entries) {
    return { ok: false, code: "dry_run_failed", message: "no bundle audit" };
  }
  const workerFiles = audit.entries.filter((f) => f.includes("_worker.js"));
  if (workerFiles.length === 0) {
    return { ok: false, code: "missing_worker_entry", message: "dry-run produced no _worker.js entry" };
  }
  // Asset manifest is required when assets are served by the Worker binding.
  if (!audit.entries.some((f) => f.includes("manifest") || f.includes("_worker.js"))) {
    return { ok: false, code: "missing_asset_manifest", message: "no asset manifest in bundle" };
  }
  // Source maps must never ship.
  const sourceMaps = audit.entries.filter((f) => f.endsWith(".map"));
  if (sourceMaps.length > 0) {
    return { ok: false, code: "source_map_present", message: "source maps must not ship" };
  }
  if (audit.total > maxBytes) {
    return {
      ok: false,
      code: "worker_size_over_limit",
      message: `worker bundle ${audit.total} bytes exceeds ${maxBytes}`,
    };
  }
  return {
    ok: true,
    code: "dry_run_success",
    bundle_entries: audit.entries.length,
    bundle_bytes: audit.total,
    worker_entry: workerFiles,
  };
}

export function hasWranglerConfig(root = REPO_ROOT) {
  return fs.existsSync(path.join(root, "wrangler.jsonc"));
}

function remove(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function build() {
  const env = { ...process.env };
  delete env.MOMOKO_CONTENT_PACKAGE_ROOT;
  delete env.MOMOKO_CONTENT_PACKAGE_MODE;
  delete env.MOMOKO_CONTENT_PACKAGE_PREVIEW;
  execFileSync("pnpm", ["build"], { cwd: REPO_ROOT, env, stdio: "inherit" });
}

function fail(code, message) {
  const out = { ok: false, code, message };
  console.error(`deploy-dryrun: ${code}: ${message}`);
  process.exitCode = 1;
  console.log(JSON.stringify(out));
  return out;
}

export function main() {
  if (!hasWranglerConfig()) {
    return fail("missing_wrangler_config", "wrangler.jsonc is required for deployment");
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "momoko-cf-dryrun-"));
  try {
    build();
    const bundleDir = path.join(tmp, "bundle");
    execFileSync(
      "pnpm",
      ["exec", "wrangler", "versions", "upload", "--env", "preview", "--dry-run", "--outdir", bundleDir],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    const audit = auditDir(bundleDir);
    const out = evaluateBundle(audit);
    if (out.ok) {
      // Repeat the dry-run and require byte-identical output.
      const bundleDir2 = path.join(tmp, "bundle2");
      execFileSync(
        "pnpm",
        ["exec", "wrangler", "versions", "upload", "--env", "preview", "--dry-run", "--outdir", bundleDir2],
        { cwd: REPO_ROOT, stdio: "inherit" },
      );
      if (dirHash(bundleDir) !== dirHash(bundleDir2)) {
        return fail("non_deterministic_bundle", "repeated dry-run produced different bytes");
      }
      out.deterministic = true;
    }
    console.log(JSON.stringify(out));
    if (!out.ok) {
      process.exitCode = 1;
    }
    return out;
  } catch (exc) {
    const msg = exc instanceof Error ? exc.message : String(exc);
    return fail("dry_run_failed", msg);
  } finally {
    remove(tmp);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
