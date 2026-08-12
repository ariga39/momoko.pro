import { afterEach, describe, expect, it } from "vitest";

import { ContentPackageError } from "../src/lib/content.ts";
import { loadProfiles, resolveProfileLocale } from "../src/lib/encyclopedia.ts";

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
