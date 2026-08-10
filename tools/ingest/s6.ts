/**
 * S6 narrow single-page source tool (task #31, serika).
 *
 * Reads exactly one human-directed official page
 * (idolmaster-official.jp/news/01_18661.html) and validates the frozen
 * `__NEXT_DATA__` structured fields. The page body is untrusted input; only the
 * allowlisted structured fields plus one human fact note may be carried into
 * the discovery/editorial seam. Every failure fails closed with zero writes.
 */

import { createHash } from "node:crypto";
import {
  normalizeDiscovery,
  type DiscoveryItem,
} from "./ingest.ts";

export const S6_SOURCE_ID = "S6";
export const S6_SOURCE_ITEM_ID = "01_18661";
export const S6_CANONICAL_URL = "https://idolmaster-official.jp/news/01_18661.html";
export const S6_ORIGIN = "https://idolmaster-official.jp";
export const S6_DSPDATE = "2026/05/25 21:00";
export const S6_PUBLISHED_AT = "2026-05-25T21:00:00+09:00";
export const S6_LNG = "ja";
export const S6_PUBLISH_STATUS = "publish";
export const S6_TITLE = "【ミリオンライブ】『究極Cuteな9周年直前ミリシタ生配信！』お知らせまとめ";

/** The single allowed human fact note (Japanese), per task contract. */
export const S6_NOTE_JA =
  "公式ポータルは、ミリオンライブ！14th LIVE の詳細発表生配信を2026年6月13日19:00（予定）にYouTubeで実施すると案内した。";

/** AI-draft translations of the fact note (zh/en). */
export const S6_NOTE_ZH =
  "官方门户通知，将于2026年6月13日19:00（预定）在YouTube播出《ミリオンライブ！14th LIVE》详情公布直播。";

export const S6_NOTE_EN =
  "The official portal announced that a livestream revealing the details of MILLION LIVE! 14th LIVE will be held on YouTube at 19:00 (scheduled) on June 13, 2026.";

/** Contract limits: 1 MiB streaming cap, 30s end-to-end deadline, ≤3 redirects. */
export const S6_MAX_BYTES = 1024 * 1024;
export const S6_DEADLINE_MS = 30_000;
export const S6_MAX_REDIRECTS = 3;
export const S6_ALLOWED_CONTENT_TYPES = ["text/html", "application/xhtml+xml"];

export type S6ErrorCode =
  | "http_non_200"
  | "content_type_invalid"
  | "response_too_large"
  | "timeout"
  | "redirect_too_many"
  | "redirect_off_origin"
  | "redirect_non_https"
  | "redirect_userinfo"
  | "redirect_not_exact_page"
  | "next_data_missing"
  | "next_data_invalid"
  | "field_missing"
  | "field_type_invalid"
  | "field_value_mismatch";

export class S6Error extends Error {
  readonly code: S6ErrorCode;

  constructor(code: S6ErrorCode, message: string) {
    super(message);
    this.name = "S6Error";
    this.code = code;
  }
}

export interface S6PageData {
  source_item_id: string;
  url: string;
  title: string;
  dspdate: string;
  lng: string;
  publish_status: string;
}

export interface S6FetchOptions {
  maxBytes?: number;
  deadlineMs?: number;
  maxRedirects?: number;
  fetcher?: typeof fetch;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Validate the redirect URL for one hop: must be HTTPS, exact allowed origin,
 * no userinfo, no query/fragment, and must resolve to the frozen exact page.
 * Throws a structured S6Error on any violation.
 */
export function validateRedirectHop(url: string): URL {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new S6Error("redirect_off_origin", "redirect target is not a valid URL");
  }
  if (parsed.protocol !== "https:") throw new S6Error("redirect_non_https", "redirect target is not HTTPS");
  if (parsed.username !== "" || parsed.password !== "") throw new S6Error("redirect_userinfo", "redirect target embeds userinfo");
  if (parsed.origin !== S6_ORIGIN) throw new S6Error("redirect_off_origin", "redirect target leaves the allowed origin");
  if (parsed.search !== "" || parsed.hash !== "") {
    throw new S6Error("redirect_not_exact_page", "redirect target carries a query or fragment");
  }
  return parsed;
}

/**
 * Streaming, byte-capped page fetch. Fails closed on: non-200, wrong
 * content type, response exceeding maxBytes (checked while streaming),
 * timeout, too many redirects, or a redirect hop off the frozen exact page.
 * Returns the full text body (bounded by maxBytes).
 */
export async function fetchS6Page(
  url: string,
  options: S6FetchOptions = {},
): Promise<string> {
  const maxBytes = options.maxBytes ?? S6_MAX_BYTES;
  const deadlineMs = options.deadlineMs ?? S6_DEADLINE_MS;
  const maxRedirects = options.maxRedirects ?? S6_MAX_REDIRECTS;
  const fetcher = options.fetcher ?? fetch;

  let current = url;
  for (let hop = 0; hop <= maxRedirects; hop += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), deadlineMs);
    let response: Response;
    try {
      response = await fetcher(current, { signal: controller.signal, redirect: "manual" });
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") {
        throw new S6Error("timeout", `request exceeded ${deadlineMs}ms deadline`);
      }
      throw new S6Error("http_non_200", `fetch failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (response.status >= 300 && response.status < 400) {
      if (hop >= maxRedirects) throw new S6Error("redirect_too_many", "too many redirects");
      const location = response.headers.get("location");
      if (!location) throw new S6Error("redirect_off_origin", "redirect response has no location");
      validateRedirectHop(location);
      if (new URL(location).href !== S6_CANONICAL_URL) {
        throw new S6Error("redirect_not_exact_page", "redirect does not resolve to the frozen exact page");
      }
      current = location;
      continue;
    }

    if (response.status !== 200) {
      throw new S6Error("http_non_200", `expected HTTP 200, got ${response.status}`);
    }
    const contentType = response.headers.get("content-type") ?? "";
    if (!S6_ALLOWED_CONTENT_TYPES.some((allowed) => contentType.toLowerCase().startsWith(allowed))) {
      throw new S6Error("content_type_invalid", `unexpected content-type: ${contentType}`);
    }
    if (!response.body) {
      throw new S6Error("response_too_large", "response has no body");
    }
    // Streaming byte cap: read chunks, count bytes, abort once over limit.
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        try { await reader.cancel(); } catch { /* best effort */ }
        throw new S6Error("response_too_large", `response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
    return Buffer.concat(chunks).toString("utf8");
  }
  throw new S6Error("redirect_too_many", "too many redirects");
}

/**
 * Extract the frozen S6 fields from the page's `__NEXT_DATA__` JSON.
 * Selector is the single strict path props.pageProps.data; there is NO
 * recursive key search or "similar field" fallback. Any missing field, wrong
 * type, or value mismatch fails closed with a structured error.
 */
export function parseS6NextData(html: string): S6PageData {
  const match = html.match(/<script\s+id="__NEXT_DATA__"\s+type="application\/json"[^>]*>([\s\S]*?)<\/script>/i);
  if (!match || match[1] === undefined) throw new S6Error("next_data_missing", "__NEXT_DATA__ script not found");
  let json: unknown;
  try {
    json = JSON.parse(match[1]);
  } catch {
    throw new S6Error("next_data_invalid", "__NEXT_DATA__ is not valid JSON");
  }
  if (!isPlainObject(json)) throw new S6Error("next_data_invalid", "__NEXT_DATA__ root is not an object");
  const props = (json as Record<string, unknown>).props;
  if (!isPlainObject(props)) throw new S6Error("field_missing", "props missing");
  const pageProps = props.pageProps;
  if (!isPlainObject(pageProps)) throw new S6Error("field_missing", "pageProps missing");
  const data = pageProps.data;
  if (!isPlainObject(data)) throw new S6Error("field_missing", "pageProps.data missing");

  const expectString = (key: keyof S6PageData): string => {
    const value = data[key];
    if (typeof value !== "string") {
      throw new S6Error(value === undefined ? "field_missing" : "field_type_invalid", `${key} is not a string`);
    }
    return value;
  };
  const rawPath = data.path;
  if (typeof rawPath !== "string") {
    throw new S6Error(rawPath === undefined ? "field_missing" : "field_type_invalid", "path is not a string");
  }
  const source_item_id = rawPath;
  const url = expectString("url");
  const title = expectString("title");
  const dspdate = expectString("dspdate");
  const lng = expectString("lng");
  const publish_status = expectString("publish_status");

  if (source_item_id !== S6_SOURCE_ITEM_ID) {
    throw new S6Error("field_value_mismatch", "path does not match 01_18661");
  }
  if (url !== S6_CANONICAL_URL) {
    throw new S6Error("field_value_mismatch", "url does not match the frozen canonical page");
  }
  if (title.trim() === "") throw new S6Error("field_type_invalid", "title is empty");
  if (dspdate !== S6_DSPDATE) {
    throw new S6Error("field_value_mismatch", "dspdate does not match 2026/05/25 21:00");
  }
  if (lng !== S6_LNG) {
    throw new S6Error("field_value_mismatch", "lng is not ja");
  }
  if (publish_status !== S6_PUBLISH_STATUS) {
    throw new S6Error("field_value_mismatch", "publish_status is not publish");
  }
  return { source_item_id, url, title, dspdate, lng, publish_status };
}

/**
 * Build the canonical (ja) discovery item for S6. Only the allowlisted fields
 * and the single human fact note are carried; page body/HTML/media/external
 * links never enter the record.
 */
export function buildS6Discovery(page: S6PageData): DiscoveryItem {
  const item = normalizeDiscovery({
    schema_version: "1",
    source_id: S6_SOURCE_ID,
    source_item_id: page.source_item_id,
    source_url: page.url,
    published_at: S6_PUBLISHED_AT,
    title: page.title,
    lang: S6_LNG,
    note: S6_NOTE_JA,
  });
  if (!item) throw new S6Error("next_data_invalid", "built discovery item failed schema validation");
  return item;
}

/** Deterministic content hash for a string (sha256 hex). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Build the full S6 pipeline record for the editorial seam: canonical ja plus
 * zh/en AI-draft translations. Pure; performs no writes.
 */
export function buildS6BundleRecord(page: S6PageData): {
  item: DiscoveryItem;
  translationDrafts: Array<{ lang: "zh" | "en"; body: string; actor: string; actor_kind: "ai"; model_version: string }>;
} {
  const item = buildS6Discovery(page);
  return {
    item,
    translationDrafts: [
      { lang: "zh", body: S6_NOTE_ZH, actor: "serika-ai-draft", actor_kind: "ai", model_version: "opencode-go/deepseek-v4-flash" },
      { lang: "en", body: S6_NOTE_EN, actor: "serika-ai-draft", actor_kind: "ai", model_version: "opencode-go/deepseek-v4-flash" },
    ],
  };
}
