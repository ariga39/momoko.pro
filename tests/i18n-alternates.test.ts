import { describe, expect, it } from "vitest";

import {
  assertIdentityClosure,
  assertReciprocal,
  newsIdentitySuffix,
  validateAlternates,
  type AlternateEntry,
} from "./helpers/i18n-alternates.ts";

const SLUG = "2026/S1-synth-2026-08-08-001/";

/** the crawl's allowed origins (localhost dev server + production site) */
const SITE_ORIGINS = new Set(["http://localhost:4321", "https://momoko.pro"]);

function detailPaths(lang: string): string {
  return `/${lang}/news/${SLUG}`;
}

function alternatesFor(langs: string[]): AlternateEntry[] {
  return langs.map((l) => ({
    hreflang: l,
    url: `https://momoko.pro/${l}/news/${SLUG}`,
    path: `/${l}/news/${SLUG}`,
  }));
}

function mislabeled(langs: string[]): AlternateEntry[] {
  const out = alternatesFor(langs);
  out[0] = { hreflang: "zh", url: "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-001/", path: "/ja/news/2026/S1-synth-2026-08-08-001/" };
  return out;
}

describe("validateAlternates — label contract", () => {
  it("accepts a well-formed trilingual alternate set", () => {
    expect(() => validateAlternates(detailPaths("zh"), alternatesFor(["zh", "ja", "en"]), SITE_ORIGINS)).not.toThrow();
  });

  it("NEGATIVE: hreflang label mismatches the URL locale (mislabeled hreflang)", () => {
    expect(() => validateAlternates(detailPaths("zh"), mislabeled(["zh", "ja", "en"]), SITE_ORIGINS)).toThrow(
      /hreflang zh does not match URL locale/,
    );
  });

  it("NEGATIVE: duplicate hreflang label", () => {
    const dup = alternatesFor(["zh", "ja", "en"]);
    dup.push({ hreflang: "ja", url: "https://momoko.pro/ja/news/2026/S1-synth-2026-08-08-001/", path: "/ja/news/2026/S1-synth-2026-08-08-001/" });
    expect(() => validateAlternates(detailPaths("zh"), dup, SITE_ORIGINS)).toThrow(/duplicate hreflang ja/);
  });

  it("NEGATIVE: hreflang outside zh/ja/en", () => {
    const weird = alternatesFor(["zh", "ja", "en"]);
    weird.push({ hreflang: "de", url: "https://momoko.pro/de/news/2026/S1-synth-2026-08-08-001/", path: "/de/news/2026/S1-synth-2026-08-08-001/" });
    expect(() => validateAlternates(detailPaths("zh"), weird, SITE_ORIGINS)).toThrow(/hreflang de not in zh\/ja\/en/);
  });

  it("NEGATIVE: empty alternate set", () => {
    expect(() => validateAlternates(detailPaths("zh"), [], SITE_ORIGINS)).toThrow(/no hreflang alternates/);
  });

  it("NEGATIVE: external alternate href must fail closed on the FULL URL (never flattened to pathname)", () => {
    const evil = alternatesFor(["zh", "ja", "en"]);
    evil[1] = { hreflang: "ja", url: "https://evil.example/ja/news/2026/S1-synth-2026-08-08-001/", path: "/ja/news/2026/S1-synth-2026-08-08-001/" };
    expect(() => validateAlternates(detailPaths("zh"), evil, SITE_ORIGINS)).toThrow(
      /alternate hreflang ja leaves allowed origins -> https:\/\/evil\.example/,
    );
  });
});

describe("assertIdentityClosure — year/slug identity contract", () => {
  it("accepts members sharing the same identity suffix", () => {
    const members = assertIdentityClosure(detailPaths("zh"), `https://momoko.pro${detailPaths("zh")}`, alternatesFor(["zh", "ja", "en"]), SITE_ORIGINS);
    expect(members.size).toBe(3);
    expect(newsIdentitySuffix(detailPaths("ja"))).toBe(SLUG);
  });

  it("NEGATIVE: canonical carries a different year/slug identity", () => {
    const wrongCanonical = "https://momoko.pro/zh/news/2025/S0-old-post-0001/";
    expect(() =>
      assertIdentityClosure(detailPaths("zh"), wrongCanonical, alternatesFor(["zh", "ja", "en"]), SITE_ORIGINS),
    ).toThrow(/canonical identity mismatch/);
  });

  it("NEGATIVE: an alternate member carries a different identity", () => {
    const badMembers = alternatesFor(["zh", "ja", "en"]);
    badMembers[1] = { hreflang: "ja", url: "https://momoko.pro/ja/news/2025/S0-old-post-0001/", path: "/ja/news/2025/S0-old-post-0001/" };
    expect(() => assertIdentityClosure(detailPaths("zh"), `https://momoko.pro${detailPaths("zh")}`, badMembers, SITE_ORIGINS)).toThrow(
      /identity member mismatch/,
    );
  });

  it("NEGATIVE: external member canonical must fail closed on the FULL URL", () => {
    const evilCanonical = "https://evil.example/zh/news/2026/S1-synth-2026-08-08-001/";
    expect(() => assertIdentityClosure(detailPaths("zh"), evilCanonical, alternatesFor(["zh", "ja", "en"]), SITE_ORIGINS)).toThrow(
      /canonical leaves allowed origins -> https:\/\/evil\.example/,
    );
  });
});

describe("assertReciprocal — reciprocal set contract", () => {
  const members = new Set(["/zh/news/2026/S1-synth-2026-08-08-001/", "/ja/news/2026/S1-synth-2026-08-08-001/", "/en/news/2026/S1-synth-2026-08-08-001/"]);

  it("accepts an identical reciprocal set", () => {
    expect(() => assertReciprocal(detailPaths("zh"), members, new Set(members))).not.toThrow();
  });

  it("NEGATIVE: member page emits a set missing one member", () => {
    const missing = new Set(["/zh/news/2026/S1-synth-2026-08-08-001/", "/en/news/2026/S1-synth-2026-08-08-001/"]);
    expect(() => assertReciprocal(detailPaths("zh"), members, missing)).toThrow(/reciprocal missing member/);
  });

  it("NEGATIVE: member page emits a set with an extra member", () => {
    const extra = new Set([...members, "/ja/news/2026/other-extra-0001/"]);
    expect(() => assertReciprocal(detailPaths("zh"), members, extra)).toThrow(/reciprocal extra member/);
  });
});
