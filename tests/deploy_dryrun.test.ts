import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { MAX_WORKER_SIZE_BYTES, auditDir, evaluateBundle, hasWranglerConfig } from "../scripts/deploy-dryrun.mjs";

describe("deploy dry-run audit (task #26)", () => {
  it("has an explicit wrangler.jsonc in the repo", () => {
    expect(hasWranglerConfig()).toBe(true);
  });

  it("fails closed when the bundle has no _worker.js entry", () => {
    const audit = { entries: ["index.html", "assets/app.css"], total: 100 };
    const out = evaluateBundle(audit);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("missing_worker_entry");
  });

  it("fails closed when the worker bundle exceeds the size limit", () => {
    const audit = { entries: ["_worker.js/index.js", "assets/app.css"], total: MAX_WORKER_SIZE_BYTES + 1 };
    const out = evaluateBundle(audit);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("worker_size_over_limit");
  });

  it("fails closed when source maps are present", () => {
    const audit = {
      entries: ["_worker.js/index.js", "_worker.js/index.js.map", "assets/app.css"],
      total: 1024,
    };
    const out = evaluateBundle(audit);
    expect(out.ok).toBe(false);
    expect(out.code).toBe("source_map_present");
  });

  it("passes when a valid _worker.js entry is within the size limit", () => {
    const audit = { entries: ["_worker.js/index.js", "assets/app.css"], total: 1024 };
    const out = evaluateBundle(audit);
    expect(out.ok).toBe(true);
    expect(out.code).toBe("dry_run_success");
    expect(out.worker_entry).toEqual(["_worker.js/index.js"]);
  });

  it("fails closed on a missing bundle audit", () => {
    const out = evaluateBundle(null);
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
