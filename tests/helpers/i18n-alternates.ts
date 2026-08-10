/**
 * Pure validation helpers for the i18n crawl contract (task #33).
 * Shared by the e2e BFS crawl and the unit negative tests below, so the
 * crawl and the tests exercise the EXACT same rules.
 */

export const LOCALES = ["zh", "ja", "en"] as const;
export type Locale = (typeof LOCALES)[number];

export interface AlternateEntry {
  hreflang: string;
  /** full absolute href (resolved against the page URL); NEVER flattened before origin checks */
  url: string;
  /** pathname of url — only safe to use after the caller validated url's origin */
  path: string;
}

export function localeOf(pathname: string): Locale | undefined {
  const match = pathname.match(/^\/(zh|ja|en)(?=\/|$)/u);
  return match?.[1] as Locale | undefined;
}

export function isNewsDetailPath(pathname: string): boolean {
  return /^\/[a-z]{2}\/news\/\d{4}\//u.test(pathname);
}

export function decodeEntities(value: string): string {
  return value.replaceAll("&#38;", "&").replaceAll("&amp;", "&");
}

/** identity suffix of a news detail path (year + slug), e.g. "2026/S1-...-001/" */
export function newsIdentitySuffix(pathname: string): string {
  const match = pathname.match(/^\/[a-z]{2}\/news\/(.+)$/u);
  return match?.[1] ?? "";
}

/** parse alternate <link> entries from html: [{hreflang, url, path}] (x-default excluded) */
export function parseAlternates(html: string, baseUrl: URL): AlternateEntry[] {
  const out: AlternateEntry[] = [];
  for (const match of html.matchAll(/<link[^>]+rel="alternate"[^>]+hreflang="([^"]+)"[^>]*href="([^"]+)"[^>]*>/gu)) {
    const hreflang = match[1] ?? "";
    const rawHref = match[2] ?? "";
    if (hreflang === "x-default") continue;
    const url = new URL(decodeEntities(rawHref), baseUrl).href;
    out.push({ hreflang, url, path: new URL(url).pathname });
  }
  return out;
}

/**
 * Per-page alternate contract:
 *   - at least one alternate
 *   - every alternate href stays on an allowed origin (checked on the FULL
 *     URL before any path use — off-domain links must fail closed, never be
 *     flattened into a same-site-looking path)
 *   - every hreflang in {zh,ja,en}
 *   - hreflang labels unique
 *   - hreflang label matches the URL's locale prefix (mislabeled => throw)
 */
export function validateAlternates(
  ownerPath: string,
  alternates: AlternateEntry[],
  allowedOrigins: ReadonlySet<string>,
): void {
  if (alternates.length === 0) throw new Error(`${ownerPath}: no hreflang alternates`);
  const seen = new Set<string>();
  for (const alt of alternates) {
    const altOrigin = new URL(alt.url).origin;
    if (!allowedOrigins.has(altOrigin)) {
      throw new Error(`${ownerPath}: alternate hreflang ${alt.hreflang} leaves allowed origins -> ${altOrigin}`);
    }
    if (!(LOCALES as readonly string[]).includes(alt.hreflang)) {
      throw new Error(`${ownerPath}: hreflang ${alt.hreflang} not in zh/ja/en`);
    }
    if (seen.has(alt.hreflang)) throw new Error(`${ownerPath}: duplicate hreflang ${alt.hreflang}`);
    seen.add(alt.hreflang);
    if (localeOf(alt.path) !== alt.hreflang) {
      throw new Error(`${ownerPath}: hreflang ${alt.hreflang} does not match URL locale ${alt.path}`);
    }
  }
}

/**
 * Detail content-identity closure:
 *   - canonical (FULL URL) must stay on an allowed origin and keep the same
 *     year/slug identity suffix as the owner page
 *   - every alternate keeps the same identity suffix and stays on an allowed
 *     origin
 *   - returns the member path set (canonical + alternates) for reciprocal checks
 */
export function assertIdentityClosure(
  ownerPath: string,
  canonicalUrl: string,
  alternates: AlternateEntry[],
  allowedOrigins: ReadonlySet<string>,
): Set<string> {
  const canonical = new URL(canonicalUrl);
  if (!allowedOrigins.has(canonical.origin)) {
    throw new Error(`${ownerPath}: canonical leaves allowed origins -> ${canonical.origin}`);
  }
  const identity = newsIdentitySuffix(ownerPath);
  if (newsIdentitySuffix(canonical.pathname) !== identity) {
    throw new Error(`${ownerPath}: canonical identity mismatch ${canonicalUrl}`);
  }
  const memberPaths = new Set([canonical.pathname, ...alternates.map((alt) => alt.path)]);
  for (const alt of alternates) {
    if (!allowedOrigins.has(new URL(alt.url).origin)) {
      throw new Error(`${ownerPath}: identity alternate leaves allowed origins -> ${new URL(alt.url).origin}`);
    }
  }
  for (const member of memberPaths) {
    if (newsIdentitySuffix(member) !== identity) {
      throw new Error(`${ownerPath}: identity member mismatch ${member}`);
    }
  }
  return memberPaths;
}

/**
 * Reciprocal closure: every member must emit exactly the same alternate set.
 * Both directions are required (missing member or extra member => throw).
 */
export function assertReciprocal(ownerPath: string, memberPaths: Set<string>, memberSet: Set<string>): void {
  for (const p of memberPaths) {
    if (!memberSet.has(p)) throw new Error(`${ownerPath}: reciprocal missing member ${p}`);
  }
  for (const p of memberSet) {
    if (!memberPaths.has(p)) throw new Error(`${ownerPath}: reciprocal extra member ${p}`);
  }
}
