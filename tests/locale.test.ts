import { describe, expect, it } from "vitest";

import {
  DEFAULT_LOCALE,
  isSafeLocalizedNext,
  localizePath,
  negotiateAcceptLanguage,
  parseCookieLocale,
  resolveRequestLocale,
} from "../src/lib/locale.ts";

describe("server locale negotiation", () => {
  it("maps supported regional language tags and uses ja for no match", () => {
    expect(negotiateAcceptLanguage("zh-CN,ja;q=0.8")).toBe("zh");
    expect(negotiateAcceptLanguage("zh-TW")).toBe("zh");
    expect(negotiateAcceptLanguage("ja-JP")).toBe("ja");
    expect(negotiateAcceptLanguage("en-US,en;q=0.8")).toBe("en");
    expect(negotiateAcceptLanguage("fr-FR,de;q=0.8")).toBeUndefined();
    expect(resolveRequestLocale(undefined, "fr-FR")).toBe(DEFAULT_LOCALE);
  });

  it("gives a valid exact cookie priority and ignores invalid values", () => {
    expect(resolveRequestLocale("en", "zh-CN")).toBe("en");
    expect(resolveRequestLocale("zh-CN", "en")).toBe("en");
    expect(parseCookieLocale("ja")).toBe("ja");
    expect(parseCookieLocale("ja-JP")).toBeUndefined();
    expect(parseCookieLocale("fr")).toBeUndefined();
  });

  it("preserves the localized path, slug, and query while changing only locale", () => {
    expect(localizePath("/zh/news/2026/momoko/?year=2026", "ja")).toBe(
      "/ja/news/2026/momoko/?year=2026",
    );
    expect(localizePath("/en/about/", "zh")).toBe("/zh/about/");
    expect(isSafeLocalizedNext("/ja/news/2026/momoko/?year=2026")).toBe(true);
    expect(isSafeLocalizedNext("https://evil.example/ja/")).toBe(false);
    expect(isSafeLocalizedNext("//evil.example/ja/")).toBe(false);
    expect(isSafeLocalizedNext("/locale-switch?locale=en")).toBe(false);
  });
});
