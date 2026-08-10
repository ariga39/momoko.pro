import type { APIRoute } from "astro";

import {
  isLocale,
  isSafeLocalizedNext,
  localeFromPath,
  LOCALE_COOKIE_MAX_AGE,
  LOCALE_COOKIE_NAME,
  type Locale,
} from "../lib/locale.ts";

export const prerender = false;

function invalidRequest(): Response {
  return new Response(JSON.stringify({ error: "invalid_locale_or_next" }), {
    status: 400,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export const GET: APIRoute = ({ url, cookies, redirect }) => {
  const locale = url.searchParams.get("locale");
  const next = url.searchParams.get("next");

  if (!isLocale(locale) || typeof next !== "string" || !isSafeLocalizedNext(next)) {
    return invalidRequest();
  }

  const nextLocale = localeFromPath(new URL(next, url.origin).pathname);
  if (nextLocale !== (locale as Locale)) return invalidRequest();

  cookies.set(LOCALE_COOKIE_NAME, locale, {
    httpOnly: true,
    maxAge: LOCALE_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    secure: import.meta.env.PROD && url.protocol === "https:",
  });

  return redirect(next, 303);
};
