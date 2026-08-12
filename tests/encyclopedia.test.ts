import { afterEach, describe, expect, it } from "vitest";

import { ContentPackageError } from "../src/lib/content.ts";
import { loadPublishedProfiles, loadProfiles } from "../src/lib/encyclopedia.ts";

const fixtureRelativeRoot = "tests/fixtures/content-package/encyclopedia";

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

describe("production encyclopedia loader eligibility", () => {
  it("production encyclopedia exposes only a reviewed Momoko profile", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = fixtureRelativeRoot;
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    const published = loadPublishedProfiles();
    // Only the reviewed Momoko profile is eligible; the draft profile is excluded.
    expect(published).toHaveLength(1);
    const momoko = published[0]!;
    expect(momoko.slug).toBe("momoko-suou");
    expect(momoko.canonical.reviewStatus).toBe("reviewed");
    // The schema requires all 18 profile facts to be present (additionalProperties=false);
    // the test independently asserts the four key frozen-inventory literals below.
    expect(momoko.canonical.facts.birthday).toBe("11月6日");
    expect(momoko.canonical.facts.height).toBe("140cm");
    expect(momoko.canonical.facts.cv).toBe("渡部恵子");
    expect(momoko.canonical.facts.nameJa).toBe("周防桃子");
    // Draft profile must not appear in the public surface.
    expect(published.map((p) => p.slug)).not.toContain("draft-profile");
  });

  it("rejects a non-ja canonical profile instead of relabeling it as ja", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = fixtureRelativeRoot;
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    // The en-canonical bundle has a canonical content.en.md (lang=en). The loader
    // must fail closed rather than relabel the canonical as ja.
    expect(() => loadProfiles()).toThrow(ContentPackageError);
  });
});
