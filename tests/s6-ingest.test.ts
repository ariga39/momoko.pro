import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { REPO_ROOT, materializeS6 } from "../tools/ingest/s6-materialize.ts";
import {
  S6_CANONICAL_URL,
  S6_SOURCE_ITEM_ID,
  S6_DSPDATE,
  S6_LNG,
  S6_PUBLISH_STATUS,
  S6Error,
  buildS6BundleRecord,
  buildS6Discovery,
  fetchS6Page,
  parseS6NextData,
  validateRedirectHop,
} from "../tools/ingest/s6.ts";
import { loadSources } from "../tools/ingest/ingest.ts";
import { validateSources } from "../tools/schema/validate.ts";

const temps: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momoko-s6-"));
  temps.push(root);
  return root;
}

afterEach(() => {
  for (const root of temps) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  temps.length = 0;
});

function htmlWith(data: unknown): string {
  return `<html><body><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { data } } })}</script></body></html>`;
}

const VALID_DATA = {
  path: S6_SOURCE_ITEM_ID,
  url: S6_CANONICAL_URL,
  title: "【ミリオンライブ】『究極Cuteな9周年直前ミリシタ生配信！』お知らせまとめ",
  dspdate: S6_DSPDATE,
  lng: S6_LNG,
  publish_status: S6_PUBLISH_STATUS,
};

describe("parseS6NextData strict single-path selector", () => {
  it("accepts the frozen valid fields", () => {
    const page = parseS6NextData(htmlWith(VALID_DATA));
    expect(page).toMatchObject({
      source_item_id: S6_SOURCE_ITEM_ID,
      url: S6_CANONICAL_URL,
      title: "【ミリオンライブ】『究極Cuteな9周年直前ミリシタ生配信！』お知らせまとめ",
      dspdate: S6_DSPDATE,
      lng: S6_LNG,
      publish_status: S6_PUBLISH_STATUS,
    });
  });

  it("rejects when __NEXT_DATA__ is missing", () => {
    expect(() => parseS6NextData("<html></html>")).toThrow(S6Error);
    expect(() => parseS6NextData("<html></html>")).toThrow(/not found/);
  });

  it("rejects when __NEXT_DATA__ is not valid JSON", () => {
    const html = `<script id="__NEXT_DATA__" type="application/json">{not json}</script>`;
    expect(() => parseS6NextData(html)).toThrow(/not valid JSON/);
  });

  it("rejects when props.pageProps.data is missing or not an object", () => {
    expect(() => parseS6NextData(`<script id="__NEXT_DATA__" type="application/json">{"props":{}}</script>`)).toThrow(/pageProps missing/);
    expect(() => parseS6NextData(`<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{}}}</script>`)).toThrow(/pageProps.data missing/);
    expect(() => parseS6NextData(`<script id="__NEXT_DATA__" type="application/json">{"props":{"pageProps":{"data":[]}}}</script>`)).toThrow(/data missing/);
  });

  it("rejects a mismatched path (source item)", () => {
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, path: "01_99999" }))).toThrow(/path does not match 01_18661/);
  });

  it("rejects a mismatched canonical url", () => {
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, url: "https://idolmaster-official.jp/news/01_99999.html" }))).toThrow(/url does not match/);
  });

  it("rejects a mismatched dspdate", () => {
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, dspdate: "2026/05/26 09:00" }))).toThrow(/dspdate does not match/);
  });

  it("rejects a non-ja lng", () => {
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, lng: "en" }))).toThrow(/lng is not ja/);
  });

  it("rejects a non-publish status", () => {
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, publish_status: "draft" }))).toThrow(/publish_status is not publish/);
  });

  it("rejects missing or wrong-typed fields", () => {
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, title: undefined }))).toThrow(/title is not a string/);
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, title: 42 }))).toThrow(/title is not a string/);
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, path: undefined }))).toThrow(/path is not a string/);
  });

  it("rejects empty title", () => {
    expect(() => parseS6NextData(htmlWith({ ...VALID_DATA, title: "   " }))).toThrow(/title is empty/);
  });

  it("does not do recursive/similar-field fallback", () => {
    // A different key with the right value at the wrong location must NOT match.
    const drifted = { ...VALID_DATA };
    delete (drifted as Record<string, unknown>).title;
    const html = `<script id="__NEXT_DATA__" type="application/json">${JSON.stringify({
      props: { pageProps: { data: drifted, elsewhere: { title: "similar" } } },
    })}</script>`;
    expect(() => parseS6NextData(html)).toThrow(/title is not a string/);
  });
});

describe("fetchS6Page bounded fetch (mocked fetcher)", () => {
  function fakeResponse(status: number, body: string, headers: Record<string, string> = {}): Response {
    const contentType = headers["content-type"] ?? "text/html; charset=utf-8";
    return new Response(body, { status, headers: { "content-type": contentType, ...headers } });
  }

  it("returns the body for a valid 200 html response", async () => {
    const fetcher = (async () => fakeResponse(200, "<html>ok</html>")) as typeof fetch;
    const text = await fetchS6Page(S6_CANONICAL_URL, { fetcher });
    expect(text).toBe("<html>ok</html>");
  });

  it("fails closed on non-200", async () => {
    const fetcher = (async () => fakeResponse(404, "not found")) as typeof fetch;
    await expect(fetchS6Page(S6_CANONICAL_URL, { fetcher })).rejects.toThrow(/expected HTTP 200, got 404/);
  });

  it("fails closed on wrong content-type", async () => {
    const fetcher = (async () => fakeResponse(200, "x", { "content-type": "application/json" })) as typeof fetch;
    await expect(fetchS6Page(S6_CANONICAL_URL, { fetcher })).rejects.toThrow(/unexpected content-type/);
  });

  it("fails closed on response exceeding the byte cap while streaming", async () => {
    const big = "a".repeat(2048);
    const fetcher = (async () => fakeResponse(200, big)) as typeof fetch;
    await expect(fetchS6Page(S6_CANONICAL_URL, { fetcher, maxBytes: 1024 })).rejects.toThrow(/exceeded 1024 bytes/);
  });

  it("fails closed on timeout via AbortController", async () => {
    const fetcher = (async () => {
      // Simulate an abort-driven rejection like fetch does.
      throw Object.assign(new Error("The operation was aborted."), { name: "AbortError" });
    }) as typeof fetch;
    await expect(fetchS6Page(S6_CANONICAL_URL, { fetcher, deadlineMs: 50 })).rejects.toThrow(/deadline/);
  });

  it("fails closed on too many redirects", async () => {
    let hops = 0;
    const fetcher = (async () => {
      hops += 1;
      return fakeResponse(302, "", { location: "https://idolmaster-official.jp/news/01_18661.html" });
    }) as typeof fetch;
    await expect(fetchS6Page(S6_CANONICAL_URL, { fetcher, maxRedirects: 1 })).rejects.toThrow(/too many redirects/);
    expect(hops).toBe(2);
  });

  it("follows a valid same-origin redirect back to the exact page", async () => {
    let calls = 0;
    const fetcher = (async (input: RequestInfo | URL) => {
      calls += 1;
      const url = String(input);
      if (calls === 1) {
        return fakeResponse(302, "", { location: "https://idolmaster-official.jp/news/01_18661.html" });
      }
      expect(url).toBe(S6_CANONICAL_URL);
      return fakeResponse(200, "<html>ok</html>");
    }) as typeof fetch;
    const text = await fetchS6Page("https://idolmaster-official.jp/redirect", { fetcher, maxRedirects: 2 });
    expect(text).toBe("<html>ok</html>");
  });
});

describe("validateRedirectHop", () => {
  it("accepts an exact-page https URL on the allowed origin", () => {
    expect(validateRedirectHop(S6_CANONICAL_URL).href).toBe(S6_CANONICAL_URL);
  });
  it("rejects non-https", () => {
    expect(() => validateRedirectHop("http://idolmaster-official.jp/news/01_18661.html")).toThrow(/not HTTPS/);
  });
  it("rejects userinfo", () => {
    expect(() => validateRedirectHop("https://u:p@idolmaster-official.jp/news/01_18661.html")).toThrow(/userinfo/);
  });
  it("rejects off-origin", () => {
    expect(() => validateRedirectHop("https://example.com/news/01_18661.html")).toThrow(/leaves the allowed origin/);
  });
  it("rejects query and fragment", () => {
    expect(() => validateRedirectHop("https://idolmaster-official.jp/news/01_18661.html?x=1")).toThrow(/query or fragment/);
    expect(() => validateRedirectHop("https://idolmaster-official.jp/news/01_18661.html#top")).toThrow(/query or fragment/);
  });
});

describe("S6 discovery + bundle record", () => {
  it("builds a schema-valid ja discovery item with only the allowlisted fields", () => {
    const page = parseS6NextData(htmlWith(VALID_DATA));
    const item = buildS6Discovery(page);
    expect(item.source_id).toBe("S6");
    expect(item.source_item_id).toBe(S6_SOURCE_ITEM_ID);
    expect(item.lang).toBe("ja");
    expect(item.note).toContain("14th LIVE");
    expect(item.note_hash).toMatch(/^sha256:[a-f0-9]{64}$/);
  });

  it("bundle record carries zh/en AI-draft translations", () => {
    const page = parseS6NextData(htmlWith(VALID_DATA));
    const { translationDrafts } = buildS6BundleRecord(page);
    expect(translationDrafts.map((d) => d.lang)).toEqual(["zh", "en"]);
    for (const draft of translationDrafts) {
      expect(draft.actor_kind).toBe("ai");
      expect(draft.body.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("S6 materialization via editorial seam", () => {
  it("materializes canonical + zh/en drafts, all review_status=draft, idempotent zero-diff", () => {
    const root = tempRoot();
    const first = materializeS6(root);
    expect(first.ok).toBe(true);
    expect(first.changed).toBe(true);
    expect(first.contentPath).toBe("content/news/2026/S6-01_18661");
    const dir = path.join(root, "content", "news", "2026", "S6-01_18661");
    for (const f of ["index.md", "content.zh.md", "content.en.md", "editorial-history.json"]) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
    const index = fs.readFileSync(path.join(dir, "index.md"), "utf8");
    expect(index).toContain("review_status: draft");
    expect(index).toContain("source_id: S6");
    expect(index).toContain("reviewed_by: null");
    for (const f of ["content.zh.md", "content.en.md"]) {
      expect(fs.readFileSync(path.join(dir, f), "utf8")).toContain("review_status: draft");
    }

    // Second run must be a zero-diff no-op across the whole tree.
    const snapshotBefore = snapshotTree(root);
    const second = materializeS6(root);
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(snapshotTree(root)).toEqual(snapshotBefore);
  });

  it("no .ingest-drafts or response/raw HTML residue is left in the repo", () => {
    const root = tempRoot();
    materializeS6(root);
    // The materialized content tree only contains the editorial bundle files.
    expect(snapshotTree(root)).not.toContain(".ingest-drafts");
    const allFiles = listFiles(root);
    expect(allFiles.some((f) => f.endsWith(".html"))).toBe(false);
    expect(allFiles.some((f) => f.includes("response"))).toBe(false);
  });
});

describe("S6 config and source policy", () => {
  it("config/sources.json validates and S1–S5 byte semantics are unchanged, S1–S6 all manual", () => {
    const r = validateSources();
    expect(r.valid, r.errors).toBe(true);
    const cfg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config", "sources.json"), "utf8"));
    const s6 = cfg.sources.find((s: { source_id: string }) => s.source_id === "S6");
    expect(s6).toMatchObject({
      source_id: "S6",
      access_control: "public",
      terms_status: "not_evaluated",
      automated_fetch: false,
      fetch_frequency: "manual",
      canonical_url: S6_CANONICAL_URL,
    });

    // S1–S5 must be byte-identical to the frozen fixture (semantics unchanged).
    const frozen = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, "tests", "fixtures", "sources-s1-s5.json"), "utf8"),
    );
    expect(cfg.sources.slice(0, 5)).toEqual(frozen);
    expect(cfg.sources.length).toBe(6);
  });

  it("loadSources returns 6 sources all automated_fetch=false and S6 not fetchable via cron seam", () => {
    const sources = loadSources();
    expect(sources).toHaveLength(6);
    expect(sources.every((s) => s.automated_fetch === false)).toBe(true);
    const s6 = sources.find((s) => s.source_id === "S6")!;
    expect(s6.automated_fetch).toBe(false);
  });
});

function snapshotTree(root: string): string {
  const lines: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      lines.push(e.isDirectory() ? `${e.name}/` : `${e.name}:${fs.readFileSync(full, "utf8")}`);
      if (e.isDirectory()) walk(full);
    }
  };
  walk(root);
  return lines.sort().join("\n");
}

function listFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else out.push(path.relative(root, full));
    }
  };
  walk(root);
  return out;
}
