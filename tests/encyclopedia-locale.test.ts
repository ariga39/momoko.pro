import { afterEach, describe, expect, it } from "vitest";

import { ContentPackageError } from "../src/lib/content.ts";
import { loadProfiles, loadPublishedProfiles, resolveProfileLocale } from "../src/lib/encyclopedia.ts";

const localeRoot = "tests/fixtures/content-package/encyclopedia-locale";

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

describe("encyclopedia locale linkage", () => {
  it("resolves a complete reviewed locale bound to the canonical profile", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = localeRoot;
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    const profiles = loadProfiles();
    const momoko = profiles.find((p) => p.slug === "momoko-suou");
    expect(momoko).toBeDefined();

    // resolveProfileLocale is the public seam; it must exist and return the
    // reviewed zh locale bound to the canonical profile.
    const zh = resolveProfileLocale(momoko!, "zh");
    expect(zh).not.toBeNull();
    expect(zh!.translated).toBe(true);
    expect(zh!.title).toBe("周防桃子");
    // Typed LocalizedProfileFacts: semantic keys, independent frozen literals.
    expect(zh!.facts.name).toBe("周防桃子");
    expect(zh!.facts.cv).toBe("渡部惠子");
    expect(zh!.facts.birthday).toBe("11月6日");
    expect(zh!.facts.tagline).toBe("逞强？小个子又倔强的妹妹系偶像！");
    expect(zh!.body.length).toBeGreaterThan(0);
  });

  it("fails closed when a locale content_path does not point to the bundle canonical", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-locale-bad";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    // A misbound locale (content_path pointing outside the bundle canonical)
    // must be rejected.
    expect(() => loadProfiles()).toThrow(ContentPackageError);
  });
});

describe("encyclopedia locale hash-drift fallback", () => {
  it("falls back to the canonical profile when the locale source_content_hash drifts", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-locale-drift";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    const momoko = loadProfiles().find((p) => p.slug === "momoko-suou")!;
    const zh = resolveProfileLocale(momoko, "zh");
    // locale source_content_hash (cccc...) != canonical content_hash (aaaa...)
    // -> must fall back to canonical with translated:false, never null.
    expect(zh).not.toBeNull();
    expect(zh.translated).toBe(false);
    expect(zh.lang).toBe("ja");
    expect(zh.title).toBe("周防桃子");
  });
});

describe("encyclopedia locale draft fallback", () => {
  it("falls back to the canonical profile when the locale is still draft", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-locale-draft";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    const momoko = loadProfiles().find((p) => p.slug === "momoko-suou")!;
    const zh = resolveProfileLocale(momoko, "zh");
    // Locale review_status=draft -> must not be treated as a real translation.
    expect(zh).not.toBeNull();
    expect(zh.translated).toBe(false);
    expect(zh.lang).toBe("ja");
  });
});

describe("encyclopedia canonical retraction", () => {
  it("excludes a reviewed profile with an active retraction from the published surface", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-locale-retracted";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    // The canonical is reviewed, but an active retraction targets its content_path.
    // loadPublishedProfiles must exclude it (retraction path semantics, not just
    // reviewStatus). Currently loadPublishedProfiles only checks reviewStatus.
    const published = loadPublishedProfiles();
    expect(published.map((p) => p.slug)).not.toContain("momoko-suou");
    expect(published).toHaveLength(0);
  });
});

describe("encyclopedia locale empty-body fallback", () => {
  it("falls back to canonical when a reviewed locale body is empty", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-locale-emptybody";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    const momoko = loadProfiles().find((p) => p.slug === "momoko-suou")!;
    const zh = resolveProfileLocale(momoko, "zh");
    // Reviewed locale with empty body must NOT be a real translation: the
    // resolver falls back to the canonical profile (translated:false).
    expect(zh).not.toBeNull();
    expect(zh.translated).toBe(false);
    expect(zh.lang).toBe("ja");
  });
});

describe("encyclopedia canonical is not a translation", () => {
  it("marks the ja canonical result as not translated", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-locale";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    const momoko = loadProfiles().find((p) => p.slug === "momoko-suou")!;
    const ja = resolveProfileLocale(momoko, "ja");
    // The canonical source-language result is never a "translation".
    expect(ja.translated).toBe(false);
  });
});

describe("encyclopedia retraction blocks locale resolution", () => {
  it("does not resolve a real locale for an actively retracted profile", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/encyclopedia-locale-retracted";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    delete process.env.PUBLIC_BUILD;

    // The profile has a valid reviewed zh locale, but its canonical has an
    // active retraction. resolveProfileLocale must NOT expose the real
    // translation: it returns the canonical fallback (translated:false).
    const momoko = loadProfiles().find((p) => p.slug === "momoko-suou")!;
    const zh = resolveProfileLocale(momoko, "zh");
    expect(zh).not.toBeNull();
    expect(zh.translated).toBe(false);
    expect(zh.lang).toBe("ja");
  });
});
