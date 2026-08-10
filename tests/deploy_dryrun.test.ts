import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { MAX_WORKER_SIZE_BYTES, auditDir, evaluateDeployRoot, hasWranglerConfig } from "../scripts/deploy-dryrun.mjs";

const REPO_ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function makeDist(extraFiles = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "momoko-dist-"));
  const files = {
    "_worker.js/index.js": "worker",
    "_assets/app.css": "css",
    ".assetsignore": "_worker.js",
    "_routes.json": "{}",
    "index.html": "<html></html>",
    ...extraFiles,
  };
  for (const [rel, content] of Object.entries(files)) {
    const full = path.join(dir, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return dir;
}

describe("deploy dry-run audit (task #26)", () => {
  it("has an explicit wrangler.jsonc in the repo", () => {
    expect(hasWranglerConfig()).toBe(true);
  });

  it("fails closed when the dist has no _worker.js entry", () => {
    const dir = makeDist();
    fs.rmSync(path.join(dir, "_worker.js"), { recursive: true, force: true });
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("missing_worker_entry");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed when .assetsignore is missing", () => {
    const dir = makeDist();
    fs.rmSync(path.join(dir, ".assetsignore"));
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("missing_assets_ignore");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed when _routes.json manifest is missing", () => {
    const dir = makeDist();
    fs.rmSync(path.join(dir, "_routes.json"));
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("missing_routes_manifest");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed when source maps appear in static assets", () => {
    const dir = makeDist({ "app.css.map": "{}" });
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("source_map_present");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed when static content contains secret-shaped markers", () => {
    const dir = makeDist({ "_assets/leak.js": "const t = 'sk_live_abcdef0123456789abcdef';" });
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("secret_shaped_content");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes a valid deploy root within the size limit", () => {
    const dir = makeDist();
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(true);
    expect(out.code).toBe("dry_run_success");
    expect(out.has_worker_entry).toBe(true);
    expect(out.has_assets_ignore).toBe(true);
    expect(out.has_routes_manifest).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed when static assets exceed the size limit", () => {
    const dir = makeDist({ "_assets/big.bin": "x".repeat(MAX_WORKER_SIZE_BYTES + 1) });
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("assets_over_limit");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed when the worker bundle exceeds the size limit", () => {
    const dir = makeDist({ "_worker.js/index.js": "w".repeat(MAX_WORKER_SIZE_BYTES + 1) });
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("worker_over_limit");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed on a missing audit", () => {
    const out = evaluateDeployRoot(null);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("dry_run_failed");
  });

  it("audits a real directory deterministically", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "momoko-audit-"));
    try {
      fs.writeFileSync(path.join(dir, "b.js"), "x");
      fs.writeFileSync(path.join(dir, "a.css"), "yy");
      fs.mkdirSync(path.join(dir, "sub"));
      fs.writeFileSync(path.join(dir, "sub", "c.js"), "zzz");
      const audit = auditDir(dir);
      expect(audit.entries).toEqual(["a.css", "b.js", "sub/c.js"]);
      expect(audit.total).toBe(6);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("preview-upload workflow contract (task #26)", () => {
  it("fails closed on confirmation/environment mismatch (no job-level skip)", () => {
    const yml = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/deploy-preview.yml"), "utf8");
    // No job-level `if` that would skip on mismatch; the gate step is always
    // reachable and must exit 1.
    expect(yml).not.toMatch(/^    if: /m);
    expect(yml).toContain('"upload-preview-version"');
    expect(yml).toContain("exit 1");
  });

  it("contains the real gated versions upload (not dry-run) and no production deploy", () => {
    const yml = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/deploy-preview.yml"), "utf8");
    expect(yml).toContain("wrangler versions upload --env preview");
    expect(yml).toContain("upload-preview-version");
    expect(yml).toContain("environment: preview");
    expect(yml).not.toContain("wrangler deploy");
    expect(yml).not.toMatch(/--dry-run/);
    expect(yml).not.toMatch(/route/);
    expect(yml).not.toMatch(/domain/);
    expect(yml).toContain("CLOUDFLARE_API_TOKEN");
    expect(yml).toContain("CLOUDFLARE_ACCOUNT_ID");
  });

  it("wires the offline dry-run audit into CI", () => {
    const ci = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("scripts/deploy-dryrun.mjs");
  });

  it("runs the offline dry-run audit before the preview upload step (wiring + order)", () => {
    const yml = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/deploy-preview.yml"), "utf8");
    const dryRunIdx = yml.indexOf("scripts/deploy-dryrun.mjs");
    // Anchor on the actual gated upload step (not the header comment).
    const uploadIdx = yml.indexOf("pnpm exec wrangler versions upload --env preview");
    expect(dryRunIdx, "preview workflow must invoke the offline dry-run script").toBeGreaterThan(-1);
    expect(uploadIdx, "preview workflow must still contain the gated versions upload").toBeGreaterThan(-1);
    expect(dryRunIdx, "dry-run audit must run before the upload step").toBeLessThan(uploadIdx);
  });

  it("keeps the dry-run audit secret-free and the upload gated (no dry-run on upload, no secrets in audit step)", () => {
    const yml = fs.readFileSync(path.join(REPO_ROOT, ".github/workflows/deploy-preview.yml"), "utf8");
    const dryRunStep = yml.slice(yml.indexOf("Offline dry-run audit"), yml.indexOf("Fail closed when required secrets are missing"));
    expect(dryRunStep).toContain("scripts/deploy-dryrun.mjs");
    expect(dryRunStep).not.toMatch(/secrets\./i);
    expect(dryRunStep).not.toMatch(/CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
    // The gated upload itself must remain a real version upload (never --dry-run).
    const uploadBlock = yml.slice(yml.indexOf("pnpm exec wrangler versions upload --env preview"));
    expect(uploadBlock).toContain("wrangler versions upload --env preview");
    expect(uploadBlock).not.toMatch(/--dry-run/);
  });
});
