export const LOCALES = ["zh", "ja", "en"] as const;

export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ja";
export const LOCALE_COOKIE_NAME = "momoko_locale";
export const LOCALE_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

export function isLocale(value: unknown): value is Locale {
  return typeof value === "string" && (LOCALES as readonly string[]).includes(value);
}

export function parseCookieLocale(value: string | null | undefined): Locale | undefined {
  return isLocale(value) ? value : undefined;
}

export function normalizeLanguageTag(value: string | null | undefined): Locale | undefined {
  if (!value) return undefined;
  const base = value.trim().toLowerCase().split(/[-_]/u)[0];
  return isLocale(base) ? base : undefined;
}

export function negotiateAcceptLanguage(header: string | null | undefined): Locale | undefined {
  if (!header) return undefined;

  const candidates = header
    .split(",")
    .map((part, index) => {
      const [rawTag, ...parameters] = part.trim().split(";");
      const qParameter = parameters.find((parameter) => parameter.trim().startsWith("q="));
      const rawQuality = qParameter?.trim().slice(2);
      const quality = rawQuality === undefined ? 1 : Number(rawQuality);
      return { tag: rawTag?.trim(), quality, index };
    })
    .filter((candidate) => candidate.tag && Number.isFinite(candidate.quality) && candidate.quality > 0)
    .sort((left, right) => right.quality - left.quality || left.index - right.index);

  for (const candidate of candidates) {
    const locale = normalizeLanguageTag(candidate.tag);
    if (locale) return locale;
  }
  return undefined;
}

export function resolveRequestLocale(
  cookieValue: string | null | undefined,
  acceptLanguage: string | null | undefined,
): Locale {
  return parseCookieLocale(cookieValue) ?? negotiateAcceptLanguage(acceptLanguage) ?? DEFAULT_LOCALE;
}

export function localeFromPath(pathname: string): Locale | undefined {
  const match = pathname.match(/^\/(zh|ja|en)(?=\/|$)/u);
  return match?.[1] as Locale | undefined;
}

export function localizePath(pathname: string, locale: Locale): string {
  const parsed = new URL(pathname, "https://momoko.pro");
  const currentLocale = localeFromPath(parsed.pathname);
  const localizedPath = currentLocale
    ? `/${locale}${parsed.pathname.slice(currentLocale.length + 1) || "/"}`
    : `/${locale}/`;
  return `${localizedPath}${parsed.search}${parsed.hash}`;
}

export function isSafeLocalizedNext(next: string | null | undefined): boolean {
  if (!next || next.length > 2048 || !next.startsWith("/") || next.startsWith("//")) {
    return false;
  }
  if (next.includes("\\") || /[\u0000-\u001f\u007f]/u.test(next)) return false;

  try {
    const parsed = new URL(next, "https://momoko.pro");
    return parsed.origin === "https://momoko.pro" && localeFromPath(parsed.pathname) !== undefined;
  } catch {
    return false;
  }
}
