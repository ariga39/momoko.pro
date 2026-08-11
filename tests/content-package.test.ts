import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  ContentPackageError,
  getContentRoot,
  loadNews,
  loadPublishedNews,
} from "../src/lib/content.ts";
import { validateFile } from "../tools/schema/validate.ts";

const fixtureRoot = path.join(
  path.resolve(process.cwd()),
  "tests",
  "fixtures",
  "content-package",
  "synthetic",
);
const fixtureBase = path.dirname(fixtureRoot);
const fixtureRelativeRoot = "tests/fixtures/content-package/synthetic";

const originalRoot = process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
const originalMode = process.env.MOMOKO_CONTENT_PACKAGE_MODE;
const originalPublicBuild = process.env.PUBLIC_BUILD;

afterEach(() => {
  if (originalRoot === undefined) delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
  else process.env.MOMOKO_CONTENT_PACKAGE_ROOT = originalRoot;
  if (originalMode === undefined) delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
  else process.env.MOMOKO_CONTENT_PACKAGE_MODE = originalMode;
  if (originalPublicBuild === undefined) delete process.env.PUBLIC_BUILD;
  else process.env.PUBLIC_BUILD = originalPublicBuild;
});

describe("versioned content package boundary", () => {
  it("loads the explicit synthetic fixture package only in test mode", () => {
    expect(getContentRoot()).toBe(fixtureRoot);
    expect(loadNews()).toHaveLength(3);
    expect(loadPublishedNews()).toHaveLength(1);
  });

  it("production package publishes the reviewed S6 trilingual bundle on all three public routes", () => {
    delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
    delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
    // The checked-in production package carries the first real content item
    // (S6). Once reviewed, it must appear in public loaders on exactly the
    // ja/zh/en news routes; synthetic fixture items and still-draft records
    // must stay excluded.
    const published = loadPublishedNews();
    expect(published).toHaveLength(1);
    const s6 = published[0]!;
    expect(s6.slug).toBe("2026/S6-01_18661");
    expect(s6.canonical.sourceId).toBe("S6");
    expect(s6.canonical.sourceItemId).toBe("01_18661");
    expect(s6.canonical.reviewStatus).toBe("reviewed");
    for (const lang of ["ja", "zh", "en"] as const) {
      expect(s6.canonical.lang === lang || s6.locales[lang]?.meta.reviewStatus === "reviewed").toBe(true);
      expect(`/${lang}/news/${s6.slug}/`).toBe(`/${lang}/news/2026/S6-01_18661/`);
    }
    // Public manifest/build sees no synthetic or still-draft items.
    const allSlugs = loadPublishedNews().map((item) => item.slug);
    expect(allSlugs).not.toContain("2026/S1-synth-2026-08-08-001");
    expect(allSlugs).not.toContain("2026/S1-synth-2026-08-08-002");
    expect(allSlugs).not.toContain("2026/S1-synth-2026-08-08-003");
  });

  it("rejects an override without explicit mode", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = fixtureRelativeRoot;
    delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
    expect(() => getContentRoot()).toThrowError(ContentPackageError);
    expect(() => getContentRoot()).toThrow(/MOMOKO_CONTENT_PACKAGE_MODE/);
  });

  it("rejects a mode without an explicit package root", () => {
    delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    expect(() => getContentRoot()).toThrow(/requires an explicit MOMOKO_CONTENT_PACKAGE_ROOT/);
  });

  it("public_build_rejects_content_override", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = fixtureRelativeRoot;
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    process.env.PUBLIC_BUILD = "1";
    expect(() => getContentRoot()).toThrow(/public build cannot use a content override/);
  });

  it("explicit_missing_content_package_fails_closed", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/does-not-exist";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    expect(() => loadNews()).toThrow(/content package directory is missing/);
    try {
      loadNews();
    } catch (error) {
      expect(String(error)).not.toContain(process.cwd());
    }
  });

  it("invalid_manifest_fails_closed", () => {
    const root = fs.mkdtempSync(path.join(fixtureBase, ".invalid-manifest-"));
    fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ package_version: "1", status: "broken" }));
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = path.relative(process.cwd(), root);
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    try {
      expect(() => loadNews()).toThrow(/content package manifest failed schema validation/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("ready_package_without_content_fails_closed", () => {
    const root = fs.mkdtempSync(path.join(fixtureBase, ".ready-without-content-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ package_version: "1", content_schema_version: "1", status: "ready" }),
    );
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = path.relative(process.cwd(), root);
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    try {
      expect(() => loadNews()).toThrow(/ready content package has no news directory/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects absolute and escaping test package paths", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = fixtureRoot;
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    expect(() => getContentRoot()).toThrow(/relative repository path/);
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "../outside-content-package";
    expect(() => getContentRoot()).toThrow(/inside the configured repository root/);
  });

  it("rejects unknown package modes", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = fixtureRelativeRoot;
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "production";
    expect(() => getContentRoot()).toThrow(/must be explicitly set to test or dev/);
  });

  it("rejects symlinked package children", () => {
    const root = fs.mkdtempSync(path.join(fixtureBase, ".symlink-package-"));
    const target = fs.mkdtempSync(path.join(fixtureBase, ".symlink-target-"));
    fs.writeFileSync(
      path.join(root, "package.json"),
      JSON.stringify({ package_version: "1", content_schema_version: "1", status: "empty" }),
    );
    fs.symlinkSync(target, path.join(root, "news"), "dir");
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = path.relative(process.cwd(), root);
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    try {
      expect(() => getContentRoot()).toThrow(/symlink/);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("rejects a test package outside the checked-in fixture root", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "../untrusted-content-package";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    expect(() => getContentRoot()).toThrow(/inside the configured repository root/);
  });

  it("locks the package manifest schema", () => {
    expect(
      validateFile("content-package.schema.json", {
        package_version: "1",
        content_schema_version: "1",
        status: "empty",
      }).valid,
    ).toBe(true);
    expect(
      validateFile("content-package.schema.json", {
        package_version: "1",
        content_schema_version: "1",
        status: "empty",
        fallback: "synthetic",
      }).valid,
    ).toBe(false);
  });
});
