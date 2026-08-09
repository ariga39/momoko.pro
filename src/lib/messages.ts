import * as m from "../paraglide/messages.js";

export type Locale = "ja" | "zh" | "en";

/**
 * Locale-aware message accessor. Paraglide's default `getLocale()` in SSG
 * resolves to the base locale, so every call must pin the route locale
 * explicitly: `ml(lang)("nav.news")` returns the message for `lang`.
 */
export function ml(lang: Locale) {
  const options = { locale: lang };
  return {
    home: () => m.home({}, options),
    homeTagline: () => m.homeTagline({}, options),
    navNews: () => m["nav.news"]({}, options),
    navAbout: () => m["nav.about"]({}, options),
    navSourcePolicy: () => m["nav.sourcePolicy"]({}, options),
    navSearch: () => m["nav.search"]({}, options),
    navMain: () => m["nav.main"]({}, options),
    navLanguage: () => m["nav.language"]({}, options),
    langZh: () => m["lang.zh"]({}, options),
    langJa: () => m["lang.ja"]({}, options),
    langEn: () => m["lang.en"]({}, options),
    newsHeading: () => m["news.heading"]({}, options),
    newsEmptyTitle: () => m["news.emptyTitle"]({}, options),
    newsEmpty: () => m["news.empty"]({}, options),
    newsMissingLocale: () => m["news.missingLocale"]({}, options),
    newsBackToList: () => m["news.backToList"]({}, options),
    newsRiskTier: (p: { tier: string }) => m["news.riskTier"](p, options),
    newsReviewStatus: (p: { status: string }) => m["news.reviewStatus"](p, options),
    newsSource: (p: { source: string }) => m["news.source"](p, options),
    notFound: () => m["notFound"]({}, options),
    notFoundBody: () => m["notFoundBody"]({}, options),
    backHome: () => m["backHome"]({}, options),
    skipToContent: () => m["skipToContent"]({}, options),
    footerNotice: () => m["footer.notice"]({}, options),
    footerDocs: () => m["footer.docs"]({}, options),
    searchHeading: () => m["search.heading"]({}, options),
    searchQuery: () => m["search.query"]({}, options),
    aboutTitle: () => m["about.title"]({}, options),
    aboutBody: () => m["about.body"]({}, options),
    policyTitle: () => m["policy.title"]({}, options),
    policyIntro: () => m["policy.intro"]({}, options),
    policyNoCopy: () => m["policy.noCopy"]({}, options),
    policyAutomated: () => m["policy.automated"]({}, options),
    policyAiUse: () => m["policy.aiUse"]({}, options),
    policyCurrentSources: () => m["policy.currentSources"]({}, options),
    policyNoCurrentSources: () => m["policy.noCurrentSources"]({}, options),
    policyCorrectionTitle: () => m["policy.correctionTitle"]({}, options),
    policyCorrectionBody: () => m["policy.correctionBody"]({}, options),
  };
}
