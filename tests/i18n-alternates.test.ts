import { describe, expect, it } from "vitest";

import {
  assertIdentityClosure,
  assertReciprocal,
  newsIdentitySuffix,
  validateAlternates,
  type AlternateEntry,
} from "./helpers/i18n-alternates.ts";

const SLUG = "2026/S1-synth-2026-08-08-001/";

function detailPaths(lang: string): string {
  return `/${lang}/news/${SLUG}`;
}

function alternatesFor(langs: string[]): AlternateEntry[] {
  return langs.map((l) => ({ hreflang: l, path: `/${l}/news/${SLUG}` }));
}

describe("validateAlternates — label contract", () => {
  it("accepts a well-formed trilingual alternate set", () => {
    expect(() => validateAlternates(detailPaths("zh"), alternatesFor(["zh", "ja", "en"]))).not.toThrow();
  });

  it("NEGATIVE: hreflang label mismatches the URL locale (mislabeled hreflang)", () => {
    const bad: AlternateEntry[] = [
      { hreflang: "zh", path: "/ja/news/2026/S1-synth-2026-08-08-001/" },
      { hreflang: "ja", path: "/ja/news/2026/S1-synth-2026-08-08-001/" },
      { hreflang: "en", path: "/en/news/2026/S1-synth-2026-08-08-001/" },
    ];
    expect(() => validateAlternates(detailPaths("zh"), bad)).toThrow(/hreflang zh does not match URL locale/);
  });

  it("NEGATIVE: duplicate hreflang label", () => {
    const dup = alternatesFor(["zh", "ja", "en"]);
    dup.push({ hreflang: "ja", path: "/ja/news/2026/S1-synth-2026-08-08-001/" });
    expect(() => validateAlternates(detailPaths("zh"), dup)).toThrow(/duplicate hreflang ja/);
  });

  it("NEGATIVE: hreflang outside zh/ja/en", () => {
    const weird = alternatesFor(["zh", "ja", "en"]);
    weird.push({ hreflang: "de", path: "/de/news/2026/S1-synth-2026-08-08-001/" });
    expect(() => validateAlternates(detailPaths("zh"), weird)).toThrow(/hreflang de not in zh\/ja\/en/);
  });

  it("NEGATIVE: empty alternate set", () => {
    expect(() => validateAlternates(detailPaths("zh"), [])).toThrow(/no hreflang alternates/);
  });
});

describe("assertIdentityClosure — year/slug identity contract", () => {
  it("accepts members sharing the same identity suffix", () => {
    const members = assertIdentityClosure(detailPaths("zh"), detailPaths("zh"), alternatesFor(["zh", "ja", "en"]));
    expect(members.size).toBe(3);
    expect(newsIdentitySuffix(detailPaths("ja"))).toBe(SLUG);
  });

  it("NEGATIVE: canonical carries a different year/slug identity", () => {
    const wrongCanonical = "/zh/news/2025/S0-old-post-0001/";
    expect(() =>
      assertIdentityClosure(detailPaths("zh"), wrongCanonical, alternatesFor(["zh", "ja", "en"])),
    ).toThrow(/canonical identity mismatch/);
  });

  it("NEGATIVE: an alternate member carries a different identity", () => {
    const badMembers = alternatesFor(["zh", "ja", "en"]);
    badMembers[1] = { hreflang: "ja", path: "/ja/news/2025/S0-old-post-0001/" };
    expect(() => assertIdentityClosure(detailPaths("zh"), detailPaths("zh"), badMembers)).toThrow(
      /identity member mismatch/,
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
