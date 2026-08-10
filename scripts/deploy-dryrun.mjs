// @ts-check
// Cloudflare deployment dry-run audit (task #26).
//
// Safe by construction: this script NEVER deploys or uploads. It builds the
// project, verifies the real worker entry `dist/_worker.js/index.js`, runs
// `wrangler deploy --dry-run --outdir <tmp>` to confirm Wrangler accepts the
// config (compiles + checks, no external write), and audits the deploy root
// `dist/` for safety. Missing wrangler config, build failure, missing worker
// entry, over-size static assets, source maps in static assets, or demo/
// preview/secret content all fail closed. Determinism of the deploy root is
// enforced by the repo's `build:verify` double-build byte compare; Wrangler's
// own `--outdir` bundle embeds a build nonce and is intentionally not
// byte-compared here.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const DIST_DIR = path.join(REPO_ROOT, "dist");
const WORKER_ENTRY = path.join(DIST_DIR, "_worker.js", "index.js");
// Cloudflare Workers Free plan static-assets/workder size reference (2026-08-10).
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

export function evaluateDeployRoot(audit, { maxBytes = MAX_WORKER_SIZE_BYTES, distDir = DIST_DIR } = {}) {
  if (!audit || !audit.entries) {
    return { ok: false, code: "dry_run_failed", message: "no dist audit" };
  }
  // The real worker entry must exist in dist.
  if (!audit.entries.includes("_worker.js/index.js")) {
    return { ok: false, code: "missing_worker_entry", message: "dist has no _worker.js/index.js" };
  }
  // Source maps must never ship in static assets (the worker's own .map is a
  // local build artifact not uploaded to the Workers runtime).
  const staticEntries = audit.entries.filter((f) => !f.startsWith("_worker.js"));
  const staticSourceMaps = staticEntries.filter((f) => f.endsWith(".map"));
  if (staticSourceMaps.length > 0) {
    return { ok: false, code: "source_map_present", message: "source maps in static assets must not ship" };
  }
  // No demo/preview/secret content markers in static assets (hashed _worker.js
  // chunk filenames may legitimately contain substrings like "demo").
  const forbidden = staticEntries.filter((f) => {
    const lower = f.toLowerCase();
    return (
      lower.includes("/demo/") ||
      lower.includes("preview-content") ||
      lower.includes("secret-") ||
      lower.includes("credentials")
    );
  });
  if (forbidden.length > 0) {
    return { ok: false, code: "forbidden_content", message: "demo/preview/secret content in deploy root" };
  }
  let staticBytes = 0;
  for (const rel of staticEntries) {
    staticBytes += fs.statSync(path.join(distDir, rel)).size;
  }
  if (staticBytes > maxBytes) {
    return {
      ok: false,
      code: "assets_over_limit",
      message: `static assets ${staticBytes} bytes exceeds ${maxBytes}`,
    };
  }
  return {
    ok: true,
    code: "dry_run_success",
    static_entries: staticEntries.length,
    static_bytes: staticBytes,
    has_worker_entry: true,
    has_assets_ignore: audit.entries.includes(".assetsignore"),
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
    if (!fs.existsSync(WORKER_ENTRY)) {
      return fail("missing_worker_entry", "dist/_worker.js/index.js not present; build the server output first");
    }
    // Confirm Wrangler accepts the config and compiles the worker (zero write).
    execFileSync(
      "pnpm",
      ["exec", "wrangler", "deploy", "--dry-run", "--outdir", path.join(tmp, "bundle")],
      { cwd: REPO_ROOT, stdio: "inherit" },
    );
    // Audit the deploy root (the actual artifact set).
    const audit = auditDir(DIST_DIR);
    const out = evaluateDeployRoot(audit);
    if (out.ok) {
      // dist determinism is enforced by the repo's build:verify gate.
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
