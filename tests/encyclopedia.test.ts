import { afterEach, describe, expect, it } from "vitest";

import { ContentPackageError } from "../src/lib/content.ts";
import { loadPublishedProfiles, loadProfiles, isRealProfileTranslation } from "../src/lib/encyclopedia.ts";

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
    expect(momoko.canonical.facts.name).toBe("周防桃子");
    // Typed loader metadata: reviewedBy/reviewedAt/sourceId/sourceItemId carried
    // through from the validated editorial history closure.
    expect(momoko.canonical.reviewedBy).toBe("fixture-reviewer");
    expect(momoko.canonical.reviewedAt).toBe("2000-01-01T00:00:00Z");
    expect(momoko.canonical.sourceId).toBe("S7");
    expect(momoko.canonical.sourceItemId).toBe("momoko-suou");
    // Draft profile must not appear in the public surface.
    expect(published.map((p) => p.slug)).not.toContain("draft-profile");
  });

  it("rejects a profile whose declared content_hash does not match its normalized semantic payload", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-hash-mismatch";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    // The canonical file carries a schema-valid sha256 that does NOT match the
    // normalized semantic payload. The loader must fail closed on the mismatch
    // instead of trusting the declared hash.
    expect(() => loadProfiles()).toThrow(ContentPackageError);
  });

  it("rejects a reviewed profile whose editorial history does not close its authorization metadata", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-history-invalid";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    // Frontmatter claims reviewed (with reviewer/time) and a valid content_hash,
    // but the editorial history only carries a draft event — no human review event
    // closes the authorization metadata. The loader must fail closed instead of
    // trusting the frontmatter alone.
    expect(() => loadProfiles()).toThrow(ContentPackageError);
  });

  it("publishes the human-approved Momoko profile at authorization msg 7e8513b5", () => {
    // Production content package (content/) — no test override. The approved
    // Momoko profile must become the single published encyclopedia entry with
    // the human authorization metadata bound to msg 7e8513b5.
    delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
    delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
    delete process.env.PUBLIC_BUILD;

    const published = loadPublishedProfiles();
    expect(published).toHaveLength(1);
    const momoko = published[0]!;
    expect(momoko.slug).toBe("momoko-suou");
    expect(momoko.canonical.reviewStatus).toBe("reviewed");
    expect(momoko.canonical.reviewedBy).toBe("@tsundere");
    expect(momoko.canonical.reviewedAt).toBe("2026-08-12T19:31:07Z");
    expect(momoko.locales.zh?.reviewStatus).toBe("reviewed");
    expect(momoko.locales.zh?.reviewedBy).toBe("@tsundere");
    expect(momoko.locales.zh?.reviewedAt).toBe("2026-08-12T19:31:07Z");
    expect(momoko.locales.en?.reviewStatus).toBe("reviewed");
    expect(momoko.locales.en?.reviewedBy).toBe("@tsundere");
    expect(momoko.locales.en?.reviewedAt).toBe("2026-08-12T19:31:07Z");
    // Coverage-only (already green): both locales resolve as real translations
    // of the approved canonical profile.
    expect(isRealProfileTranslation(momoko, "zh")).toBe(true);
    expect(isRealProfileTranslation(momoko, "en")).toBe(true);
  });

  it("rejects reviewed history with missing or malformed event identity", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-history-malformed";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    // A reviewed profile whose editorial history event identity is missing or
    // malformed (event_id absent/empty/non-UUID, operation_id absent/empty)
    // must be rejected. The package holds one bundle per variant; the loader
    // walks all of them, so any accepted malformed bundle makes this throw.
    expect(() => loadProfiles()).toThrow(ContentPackageError);
  });

  it("rejects a non-ja canonical profile instead of relabeling it as ja", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-en";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    // The en-canonical bundle has a canonical content.en.md (lang=en). The loader
    // must fail closed rather than relabel the canonical as ja.
    expect(() => loadProfiles()).toThrow(ContentPackageError);
  });
});
