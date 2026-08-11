import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";

import {
  hasTranslation,
  isRealTranslation,
  loadNews,
  resolveLocale,
  getContentRoot,
} from "../src/lib/content.ts";

// Translation eligibility（design §1.2）: body 非空、reviewed、
// source_content_hash === canonical hash、未 retracted，否则 fail-closed 回退。

// The retraction case must never write into the shared
// tests/fixtures/content-package/synthetic/retractions dir: loadNews() scans
// that dir for every caller, so a transient probe.json would race with parallel
// build-artifacts tests.  We isolate via a per-test temp-copy content package
// under the allowed fixtures parent, stub the env to it, and clean up in nested
// finally blocks (probe/copy/env restore each run even if a prior step throws).

const REPO_ROOT = process.cwd();
const FIXTURE_BASE = path.join(REPO_ROOT, "tests", "fixtures", "content-package");
const SYNTHETIC_PKG = path.join(FIXTURE_BASE, "synthetic");
// Task-specific prefix so a global residue scan never mistakes another
// concurrent instance's temp dir for ours (and vice versa).
const TEMP_PREFIX = "tmp-anno34-";

// The single mutable-probe isolation helper: creates a per-test temp-copy
// content package, points the content root at it, and guarantees env restore
// (unconditionally) + owned-temp removal (outer finally) so every failure path
// cleans up, including throws in realpath/cp/write BEFORE env stubbing begins.
//
// The returned result carries the owned tmp path so a test can assert that
// exact path is removed without requiring other concurrent instances' temp
// dirs to be absent.
function isolatedProbeRun<T>(
  probe: { content_path: string },
  body: (root: string) => T,
): { result: T; ownedTmp: string } {
  const rootEnv = "MOMOKO_CONTENT_PACKAGE_ROOT";
  const modeEnv = "MOMOKO_CONTENT_PACKAGE_MODE";
  const tmp = fs.mkdtempSync(path.join(FIXTURE_BASE, TEMP_PREFIX));
  try {
    // Outer scope: everything below runs with cleanup guaranteed in the outer
    // finally.  A throw at ANY step (realpath/containment/cp/write/stub/body)
    // still reaches the outer finally and removes the owned temp dir.
    const tmpReal = fs.realpathSync(tmp);
    const fixtureReal = fs.realpathSync(FIXTURE_BASE);
    if (!tmpReal.startsWith(fixtureReal + path.sep)) {
      throw new Error("temp content package escaped the allowed fixtures parent");
    }
    const pkg = path.join(tmp, "pkg");
    fs.cpSync(SYNTHETIC_PKG, pkg, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, "retractions", "probe.json"),
      JSON.stringify({
        schema_version: "1",
        id: "probe",
        content_path: probe.content_path,
        status: "active",
        reason: "synthetic probe",
        requested_at: "2026-08-09T00:00:00+09:00",
        requested_by: "reviewer-demo",
      }),
    );
    const rootValue = path.relative(REPO_ROOT, pkg);

    // Inner scope: unconditional env restore.  unstubAllEnvs is safe even if
    // only the first stub succeeded or if neither did (vitest treats a missing
    // stub as a no-op), so we never skip restore on partial side effects.
    try {
      vi.stubEnv(rootEnv, rootValue);
      vi.stubEnv(modeEnv, "test");
      const result = body(pkg);
      return { result, ownedTmp: tmp };
    } finally {
      vi.unstubAllEnvs();
    }
  } finally {
    // Unconditional owned-temp removal, even if env restore or the body threw.
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

describe("translation eligibility — fail-closed", () => {
  it("fixture 001 zh is a real translation; 002 zh is a draft record and not eligible", () => {
    const items = loadNews();
    const item1 = items.find((i) => i.slug.includes("001"))!;
    const item2 = items.find((i) => i.slug.includes("002"))!;
    expect(isRealTranslation(item1, "zh")).toBe(true);
    expect(hasTranslation(item1, "zh")).toBe(true);
    expect(resolveLocale(item1, "zh").translated).toBe(true);
    expect(isRealTranslation(item2, "zh")).toBe(false);
    expect(item2.locales.zh?.meta.reviewStatus).toBe("draft");
    expect(resolveLocale(item2, "zh").translated).toBe(false);
    expect(resolveLocale(item2, "zh").body).toBe(item2.canonicalBody);
  });

  it("draft locale is not a real translation (review_status !== reviewed)", () => {
    const items = loadNews();
    const item2 = items.find((i) => i.slug.includes("002"))!;
    // 002 canonical is draft; its locales fall back regardless of presence.
    expect(isRealTranslation(item2, "ja")).toBe(false);
  });

  it("empty-body translation is not a real translation", () => {
    const items = loadNews();
    const item1 = items.find((i) => i.slug.includes("001"))!;
    // simulate an empty-body locale file
    const clone: typeof item1 = {
      ...item1,
      locales: {
        ...item1.locales,
        en: { ...item1.locales.en!, body: "   " },
      },
    };
    expect(isRealTranslation(clone, "en")).toBe(false);
  });

  it("source_content_hash mismatch (drift) is not a real translation", () => {
    const items = loadNews();
    const item1 = items.find((i) => i.slug.includes("001"))!;
    const clone: typeof item1 = {
      ...item1,
      locales: {
        ...item1.locales,
        en: { ...item1.locales.en!, meta: { ...item1.locales.en!.meta, sourceContentHash: "sha256:" + "0".repeat(64) } },
      },
    };
    expect(isRealTranslation(clone, "en")).toBe(false);
  });

  it("retracted content is not a real translation (and canonical stays fallback)", () => {
    const items = loadNews();
    const item1 = items.find((i) => i.slug.includes("001"))!;

    // Snapshot the shared synthetic retractions tree bytes BEFORE the probe run
    // so we can prove zero mutation.
    const syntheticTreeBefore = snapshotTreeBytes(SYNTHETIC_PKG);

    const contentPath = `content/news/${item1.slug}/index.md`;
    const { ownedTmp } = isolatedProbeRun({ content_path: contentPath }, (pkg) => {
      const reloaded = loadNews().find((i) => i.slug.includes("001"))!;
      expect(isRealTranslation(reloaded, "zh")).toBe(false);
      expect(resolveLocale(reloaded, "zh").translated).toBe(false);
      // The probe is visible through the isolated content root.
      const root = getContentRoot();
      expect(fs.existsSync(path.join(root, "retractions", "probe.json"))).toBe(true);
      // The probe content_path matches the item under isolation.
      const probeRecord = JSON.parse(
        fs.readFileSync(path.join(root, "retractions", "probe.json"), "utf8"),
      ) as { content_path: string };
      expect(probeRecord.content_path).toBe(contentPath);
      return pkg;
    });

    // Shared synthetic tree byte-identical, no probe, and THIS test's owned
    // temp dir is gone (we assert only our own path, never a global set).
    expect(snapshotTreeBytes(SYNTHETIC_PKG)).toEqual(syntheticTreeBefore);
    expect(fs.existsSync(path.join(SYNTHETIC_PKG, "retractions", "probe.json"))).toBe(false);
    expect(fs.existsSync(ownedTmp)).toBe(false);
  });

  it("callback throw still restores env and removes the owned temp copy", () => {
    // A real negative: the body throws after the probe write; env must be
    // restored and the owned temp dir removed despite the throw.  We capture
    // the owned pkg path from the callback argument before throwing.
    let ownedSeen: string | undefined;
    expect(() =>
      isolatedProbeRun({ content_path: "content/news/2026/S1-synth-2026-08-08-001/index.md" }, (pkg) => {
        ownedSeen = path.dirname(pkg);
        expect(getContentRoot()).toContain(TEMP_PREFIX);
        throw new Error("synthetic callback failure");
      }),
    ).toThrow("synthetic callback failure");
    expect(process.env.MOMOKO_CONTENT_PACKAGE_ROOT).toBe(
      "tests/fixtures/content-package/synthetic",
    );
    expect(process.env.MOMOKO_CONTENT_PACKAGE_MODE).toBe("test");
    if (ownedSeen !== undefined) {
      expect(fs.existsSync(ownedSeen)).toBe(false);
    }
  });

  it("throw before env stubbing still removes the owned temp dir", () => {
    // A real negative for the outer-finally cleanup: inject a throw DURING the
    // temp-copy setup (before any env stub) and prove the owned temp dir is
    // removed.  monkeypatch cpSync to throw once inside the helper's setup.
    let ownedSeen: string | undefined;
    const spy = vi.spyOn(fs, "cpSync").mockImplementation(((...args: unknown[]) => {
      // The tmp dir exists by now; record it from the destination argument.
      const dest = args[1] as string;
      ownedSeen = path.dirname(dest);
      throw new Error("synthetic copy failure");
    }) as typeof fs.cpSync);
    try {
      expect(() =>
        isolatedProbeRun({ content_path: "content/news/x/index.md" }, () => {
          throw new Error("unreachable");
        }),
      ).toThrow("synthetic copy failure");
    } finally {
      spy.mockRestore();
    }
    // The owned temp dir that existed before the copy throw is now removed.
    if (ownedSeen !== undefined) {
      expect(fs.existsSync(ownedSeen)).toBe(false);
    }
  });
});

// Byte-exact tree snapshot (SHA-256 per file), never a UTF-8 string decode, so
// arbitrary/invalid byte sequences are compared exactly.
function snapshotTreeBytes(root: string): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`unexpected symlink in fixture tree: ${full}`);
      }
      if (entry.isDirectory()) {
        walk(full);
      } else if (entry.isFile()) {
        const buf = fs.readFileSync(full);
        out.push([path.relative(root, full), crypto.createHash("sha256").update(buf).digest("hex")]);
      }
    }
  };
  walk(root);
  return out.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
}
