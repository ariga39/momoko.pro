import type { APIContext, MiddlewareHandler } from "astro";

import { configureRuntimeEnv } from "./lib/runtime-config.ts";
import { LOCALE_COOKIE_NAME, resolveRequestLocale } from "./lib/locale.ts";

export const onRequest: MiddlewareHandler = async (context: APIContext, next) => {
  const runtime = (context.locals as { runtime?: { env?: unknown } }).runtime;
  configureRuntimeEnv(runtime?.env);

  const pathname = context.url.pathname;

  // Root entry negotiation: cookie -> Accept-Language -> ja, returned with
  // Astro's redirect API. Astro i18n prefix-always routing keeps the default
  // locale prefixed (/ja/...) and disables its own / redirect
  // (redirectToDefaultLocale: false), so this seam owns the negotiation.
  if (pathname === "/") {
    const locale = resolveRequestLocale(
      context.cookies.get(LOCALE_COOKIE_NAME)?.value,
      context.request.headers.get("accept-language"),
    );
    return context.redirect(`/${locale}/`, 302);
  }

  // Legacy unprefixed /search: negotiate the locale and redirect to the
  // localized route. With prefix-always routing the built-in middleware would
  // 404 non-locale routes, so this seam lives here instead of a page.
  if (pathname === "/search") {
    const locale = resolveRequestLocale(
      context.cookies.get(LOCALE_COOKIE_NAME)?.value,
      context.request.headers.get("accept-language"),
    );
    return context.redirect(`/${locale}/search/`, 303);
  }

  return next();
};
