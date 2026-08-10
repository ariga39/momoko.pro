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

  it("fails closed when source maps appear in static assets", () => {
    const dir = makeDist({ "app.css.map": "{}" });
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("source_map_present");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("passes a valid deploy root within the size limit", () => {
    const dir = makeDist();
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(true);
    expect(out.code).toBe("dry_run_success");
    expect(out.has_worker_entry).toBe(true);
    expect(out.has_assets_ignore).toBe(true);
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("fails closed when static assets exceed the size limit", () => {
    const dir = makeDist({ "_assets/big.bin": "x".repeat(MAX_WORKER_SIZE_BYTES + 1) });
    const out = evaluateDeployRoot(auditDir(dir), { distDir: dir });
    expect(out.ok).toBe(false);
    expect(out.code).toBe("assets_over_limit");
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
});
