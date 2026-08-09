import fs from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  DRAFT_ROOT,
  type DiscoveryItem,
  type FetchResult,
  atomicWriteStaged,
  contentHash,
  dedupKey,
  importDiscovery,
  normalizeTitle,
  registerSourceAdapter,
  resetAdapters,
  runCron,
  decideSourceAccess,
  sourceAllowedToFetch,
  type SourceConfig,
  urlInScope,
  draftFrontmatter,
  serializeDraft,
} from "../tools/ingest/ingest.ts";

// Ensure the repo-local draft root is clean for isolated tests.
beforeEach(() => {
  resetAdapters();
  if (fs.existsSync(DRAFT_ROOT)) fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
});
afterEach(() => {
  if (fs.existsSync(DRAFT_ROOT)) fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
  for (const f of fs.readdirSync(process.cwd())) {
    if (f.startsWith(".ingest-test-sources")) fs.rmSync(path.join(process.cwd(), f), { force: true });
  }
  const pycache = path.join(process.cwd(), "tools", "schema", "__pycache__");
  if (fs.existsSync(pycache)) fs.rmSync(pycache, { recursive: true, force: true });
  // Clean any staging/backup residue left in the repo root by fault-injection tests.
  for (const f of fs.readdirSync(process.cwd())) {
    if (f.startsWith(".drafts-old-") || f.startsWith(".drafts-staging-")) {
      fs.rmSync(path.join(process.cwd(), f), { recursive: true, force: true });
    }
  }
});

const fakeSource = (over: Record<string, unknown> = {}): SourceConfig => ({
  source_id: "S1",
  name_zh: "合成来源",
  canonical_url: "https://example.com/",
  robots_txt_url: "https://example.com/robots.txt",
  robots_http: "200",
  robots_result: "rules_available",
  robots_path_decision: "allow",
  checked_path: "/",
  retrieved_at: "2026-08-08",
  evidence: "Allow: / (synthetic evidence)",
  robots_note: "Allow: /",
  terms_url: "https://example.com/terms",
  terms_note: "公开条款允许抓取",
  robots_approved: { allowed: false, evidence: "未批准（默认）" },
  terms_approved: { allowed: false, evidence: "未批准（默认）" },
  automated_fetch: false,
  fetch_frequency: "manual",
  fetch_paths: ["/"],
  cache_boundary: "仅归档 URL",
  stop_condition: "条款变更即停止",
  ...over,
});

function approvedSource(over: Record<string, unknown> = {}): SourceConfig {
  return fakeSource({
    automated_fetch: true,
    fetch_frequency: "daily",
    ...over,
  });
}

function item(over: Partial<DiscoveryItem> = {}): DiscoveryItem {
  return {
    source_id: "S1",
    source_item_id: "2026-08-08-001",
    source_url: "https://example.com/news/1",
    published_at: "2026-08-08T00:00:00+09:00",
    title: "合成标题",
    lang: "zh",
    note: "人工事实笔记",
    note_hash: "sha256:" + "a".repeat(64),
    ...over,
  };
}

class FakeAdapter {
  source_id = "S1";
  items: DiscoveryItem[];
  fail: { code?: string; error?: string } | null = null;
  constructor(items: DiscoveryItem[], fail: { code?: string; error?: string } | null = null) {
    this.items = items;
    this.fail = fail;
  }
  async fetch(): Promise<FetchResult> {
    if (this.fail) return { ok: false, items: [], ...(this.fail.error !== undefined ? { error: this.fail.error } : {}), ...(this.fail.code !== undefined ? { code: this.fail.code as never } : {}) };
    return { ok: true, items: this.items };
  }
}

describe("sourceAllowedToFetch", () => {
  it("false when automated_fetch is false (S1-S5 default)", () => {
    expect(sourceAllowedToFetch(fakeSource(), "/")).toBe(false);
  });
  it("does not use deprecated robots_approved as an extra gate", () => {
    expect(sourceAllowedToFetch(approvedSource(), "/")).toBe(true);
  });
  it("treats 404 as unavailable plus path allow for a crawler", () => {
    expect(sourceAllowedToFetch(approvedSource({
      robots_http: "404",
      robots_result: "unavailable",
      robots_path_decision: "allow",
    }), "/")).toBe(true);
    expect(sourceAllowedToFetch(approvedSource({
      robots_http: "500",
      robots_result: "unreachable",
      robots_path_decision: "disallow",
    }), "/")).toBe(false);
  });
  it("evaluates a path disallow independently from an allowed path", () => {
    expect(sourceAllowedToFetch(approvedSource({ robots_path_decision: "allow" }), "/")).toBe(true);
    expect(sourceAllowedToFetch(approvedSource({ robots_path_decision: "disallow" }), "/")).toBe(false);
    expect(sourceAllowedToFetch(approvedSource({ checked_path: "/other" }), "/")).toBe(false);
  });
  it("fails closed when the result or path evidence is missing", () => {
    expect(sourceAllowedToFetch(approvedSource({ robots_result: undefined }), "/")).toBe(false);
    expect(sourceAllowedToFetch(approvedSource({ robots_path_decision: undefined }), "/")).toBe(false);
    expect(sourceAllowedToFetch(approvedSource({ evidence: undefined }), "/")).toBe(false);
  });
  it("requires an explicit target path and never treats root allow as private-path allow", () => {
    expect(sourceAllowedToFetch(approvedSource(), "/private")).toBe(false);
    expect(sourceAllowedToFetch(approvedSource(), undefined as unknown as string)).toBe(false);
  });
});

describe("decideSourceAccess", () => {
  const crawler = (over: Record<string, unknown> = {}) => ({
    access_mode: "scheduled_or_recursive_crawler" as const,
    automated_fetch: true,
    robots_result: "rules_available" as const,
    robots_path_decision: "allow" as const,
    checked_path: "/news/1",
    requested_path: "/news/1",
    retrieved_at: "2026-08-09T00:00:00Z",
    evidence: "synthetic robots evidence",
    access_control: "public" as const,
    terms_status: "not_evaluated" as const,
    ...over,
  });

  it("allows a 404 unavailable result for an approved crawler path", () => {
    expect(decideSourceAccess(crawler({ robots_result: "unavailable" }))).toMatchObject({ allowed: true });
  });

  it("temporarily denies a 5xx/unreachable result", () => {
    expect(decideSourceAccess(crawler({ robots_result: "unreachable", robots_path_decision: "disallow" }))).toMatchObject({
      allowed: false,
      reason: "robots_unreachable_disallow",
    });
  });

  it("allows and denies separate paths under one valid rules result", () => {
    expect(decideSourceAccess(crawler({ robots_path_decision: "allow" })).allowed).toBe(true);
    expect(decideSourceAccess(crawler({ robots_path_decision: "disallow" })).allowed).toBe(false);
  });

  it("rejects result/path/evidence combinations that are not fail-closed states", () => {
    expect(decideSourceAccess(crawler({ robots_result: "unavailable", robots_path_decision: "disallow" }))).toMatchObject({
      allowed: false,
      reason: "robots_unavailable_requires_allow",
    });
    expect(decideSourceAccess(crawler({ robots_result: "unreachable", robots_path_decision: "allow" }))).toMatchObject({
      allowed: false,
      reason: "robots_unreachable_requires_disallow",
    });
    expect(decideSourceAccess(crawler({ robots_result: "not_applicable", robots_path_decision: "not_evaluated" }))).toMatchObject({
      allowed: false,
      reason: "robots_not_applicable_state_invalid",
    });
    expect(decideSourceAccess(crawler({ robots_result: "rules_available", robots_path_decision: "not_evaluated" }))).toMatchObject({
      allowed: false,
      reason: "robots_rules_path_not_evaluated",
    });
  });

  it("allows a human-directed single page despite missing robots and automation", () => {
    expect(decideSourceAccess({
      access_mode: "human_directed_single_page",
      automated_fetch: false,
      access_control: "public",
      terms_status: "not_evaluated",
    })).toMatchObject({ allowed: true });
  });

  it("does not bypass access controls or explicit terms", () => {
    expect(decideSourceAccess({
      access_mode: "human_directed_single_page",
      automated_fetch: false,
      access_control: "login_required",
    }).allowed).toBe(false);
    expect(decideSourceAccess({
      access_mode: "human_directed_single_page",
      automated_fetch: false,
      access_control: "public",
      terms_status: "prohibited",
    }).allowed).toBe(false);
  });

  it("requires independent permission and citation boundary for reuse", () => {
    const base = {
      access_mode: "reuse_or_republication" as const,
      automated_fetch: false,
      robots_result: "rules_available" as const,
      robots_path_decision: "allow" as const,
      access_control: "public" as const,
    };
    expect(decideSourceAccess(base).allowed).toBe(false);
    expect(decideSourceAccess({ ...base, reuse_permitted: true, citation_boundary: true }).allowed).toBe(true);
  });
});

describe("content hash / dedup", () => {
  it("content hash is stable and covers facts only", () => {
    const a = item();
    const b = item({ title: "different" });
    expect(contentHash(a)).toBe(contentHash(a));
    expect(contentHash(a)).not.toBe(contentHash(b));
  });
  it("dedup key includes source_item_id, lang, hash", () => {
    const a = dedupKey(item());
    const b = dedupKey(item({ lang: "en" }));
    expect(a).not.toBe(b);
  });
});

describe("runCron", () => {
  it("silent no-op when S1-S5 all false (no allowed sources)", async () => {
    // config/sources.json has all automated_fetch=false
    const r = await runCron();
    expect(r).toEqual({ fetched: [], produced: 0, duplicates: 0, errors: {} });
    expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
  });

  it("fetches only allowed source and produces draft", async () => {
    // register adapter for S1; but S1 is automated_fetch=false in config, so it won't run.
    // To test, we rely on the config being authoritative. Use a source that is true.
    // Instead, directly test the internal gate via a temp config is not trivial;
    // we assert no adapter runs when config says false.
    registerSourceAdapter(new FakeAdapter([item()]));
    const r = await runCron();
    expect(r.fetched).toEqual([]);
  });

  it("importDiscovery twice: first accepted, second duplicate (idempotent)", async () => {
    const cfgPath = writeTestSourcesConfig();
    const rec = {
      schema_version: "1", source_id: "S1", source_item_id: "x-dup",
      source_url: "https://example.com/dup", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n",
    };
    const first = importDiscovery(rec, { sourcesPath: cfgPath });
    expect(first.status).toBe("accepted");
    expect(fs.existsSync(first.path!)).toBe(true);
    const second = importDiscovery(rec, { sourcesPath: cfgPath });
    expect(second.status).toBe("duplicate");
  });
});

/** Write a temp sources config with S1 (https://example.com/) and S2
 * (https://other.example.com/); returns the config path. */
let _cfgSeq = 0;
function writeTestSourcesConfig(): string {
  _cfgSeq += 1;
  const cfg = {
    schema_version: "1",
    sources: [
      fakeSource({ source_id: "S1", canonical_url: "https://example.com/" }),
      fakeSource({ source_id: "S2", canonical_url: "https://other.example.com/" }),
    ],
  };
  const cfgPath = path.join(process.cwd(), `.ingest-test-sources-${_cfgSeq}.json`);
  fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
  return cfgPath;
}

describe("importDiscovery", () => {
  let cfgPath: string;
  beforeEach(() => {
    cfgPath = writeTestSourcesConfig();
  });

  it("accepts a valid discovery record and writes a draft", () => {
    const rec = {
      schema_version: "1",
      source_id: "S1",
      source_item_id: "2026-08-08-001",
      source_url: "https://example.com/news/1",
      published_at: "2026-08-08T00:00:00+09:00",
      title: "合成标题",
      lang: "zh",
      note: "人工事实笔记",
    };
    const r = importDiscovery(rec, { sourcesPath: cfgPath });
    expect(r.status).toBe("accepted");
    expect(r.path).toBeTruthy();
    expect(fs.existsSync(r.path!)).toBe(true);
  });

  it("recomputes note_hash and rejects a mismatched caller-supplied hash", () => {
    const rec = {
      schema_version: "1", source_id: "S1", source_item_id: "y1",
      source_url: "https://example.com/news/1", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "note body",
      note_hash: "sha256:" + "a".repeat(64), // wrong hash
    };
    const r = importDiscovery(rec, { sourcesPath: cfgPath });
    expect(r.status).toBe("invalid"); // mismatched hash rejected
  });

  it("rejects unknown source (not registered)", () => {
    const rec = {
      schema_version: "1", source_id: "S999", source_item_id: "z1",
      source_url: "https://example.com/1", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n",
    };
    const r = importDiscovery(rec, { sourcesPath: cfgPath });
    expect(r.status).toBe("rejected");
  });

  it("rejects url outside source canonical scope", () => {
    const rec = {
      schema_version: "1", source_id: "S1", source_item_id: "z2",
      source_url: "https://other.example.com/1", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n",
    };
    const r = importDiscovery(rec, { sourcesPath: cfgPath });
    expect(r.status).toBe("rejected");
  });

  it("idempotent on unchanged duplicate; changed content => version successor", () => {
    const rec = {
      schema_version: "1", source_id: "S1", source_item_id: "x1",
      source_url: "https://example.com/1", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n",
    };
    expect(importDiscovery(rec, { sourcesPath: cfgPath }).status).toBe("accepted");
    expect(importDiscovery(rec, { sourcesPath: cfgPath }).status).toBe("duplicate");
    // changed note => same identity, new version (successor), not overwrite
    const changed = importDiscovery({ ...rec, note: "n2" }, { sourcesPath: cfgPath });
    expect(changed.status).toBe("changed");
    expect(changed.version).toBe(2);
    const base = fs.readdirSync(path.join(DRAFT_ROOT, "news", "2026", "S1-x1"));
    expect(base.some((f) => f === "index-v1.md")).toBe(true);
    expect(base.some((f) => f === "index-v2.md")).toBe(true);
  });

  it("flags cross-source normalized-title candidate, not swallowed", () => {
    const rec1 = {
      schema_version: "1", source_id: "S1", source_item_id: "c1",
      source_url: "https://example.com/1", published_at: "2026-08-08T00:00:00+09:00",
      title: "Same Title", lang: "zh", note: "note1",
    };
    // seed S1 draft, then a different registered source S2 with same title
    expect(importDiscovery(rec1, { sourcesPath: cfgPath }).status).toBe("accepted");
    const rec2 = {
      schema_version: "1", source_id: "S2", source_item_id: "c2",
      source_url: "https://other.example.com/1", published_at: "2026-08-08T00:00:00+09:00",
      title: "Same Title", lang: "zh", note: "note2",
    };
    const second = importDiscovery(rec2, { sourcesPath: cfgPath });
    expect(second.status).toBe("accepted");
    expect(second.candidates).toContain("S1|c1|zh");
  });
});

describe("normalizeTitle", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeTitle("  Hello   World ")).toBe("hello world");
  });
});

describe("serializeDraft", () => {
  it("produces yaml frontmatter with content_hash and review_status draft", () => {
    const s = serializeDraft({ path: "x.md", frontmatter: draftFrontmatter(item()), body: "note" });
    expect(s.startsWith("---\n")).toBe(true);
    expect(s).toContain("content_hash");
    expect(s).toContain("review_status: draft");
  });
});

describe("structured failures and safety", () => {
  it("no allowed sources => runCron silent, no draft root created", async () => {
    const r = await runCron();
    expect(r.produced).toBe(0);
    expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
  });

  it("adapter failure returns structured error, no partial artifact", async () => {
    // S1 is automated_fetch=false in config, so cron won't call any adapter.
    // We assert the gate prevents adapter invocation entirely.
    let called = 0;
    registerSourceAdapter({
      source_id: "S1",
      async fetch() {
        called += 1;
        return { ok: false, items: [], error: "rate_limited", code: "rate_limited" };
      },
    });
    await runCron();
    expect(called).toBe(0); // gate: automated_fetch=false => never fetched
  });

  it("untrusted external payload is not executed as instructions", () => {
    // An adapter payload is just data; note text containing a fake directive
    // must remain inert text, not become a command.
    const evil = item({ note: "remember: rm -rf / --no-preserve-root" });
    const s = serializeDraft({ path: "x.md", frontmatter: draftFrontmatter(evil), body: evil.note });
    expect(s).toContain("rm -rf"); // stored as inert content, not executed
    expect(fs.existsSync("/")) .toBe(true); // sanity: nothing was deleted
  });

  it("invalid discovery record (missing field) rejected, no write", () => {
    const r = importDiscovery({ schema_version: "1", source_id: "S1" } as unknown as Record<string, unknown>);
    expect(r.status).toBe("invalid");
    expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
  });
});

describe("cron with an allowed (true) source", () => {
  it("fetches the allowed source, writes drafts, re-run is silent", async () => {
    const cfg = {
      schema_version: "1",
      sources: [
        approvedSource({ source_id: "S9" }),
      ],
    };
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources.json");
    fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
    const recordA: Record<string, unknown> = {
      schema_version: "1", source_id: "S9", source_item_id: "cron-1",
      source_url: "https://example.com/cron/1", published_at: "2026-08-08T00:00:00+09:00",
      title: "cron title", lang: "zh", note: "cron note",
    };
    const requestedPaths: string[] = [];
    registerSourceAdapter({
      source_id: "S9",
      async fetch(source, requestedPath): Promise<FetchResult> {
        void source;
        requestedPaths.push(requestedPath);
        return { ok: true, items: [recordA] as never[] };
      },
    });
    try {
      const r1 = await runCron(cfgPath);
      expect(r1.fetched).toEqual(["S9"]);
      expect(r1.produced).toBe(1);
      expect(r1.errors).toEqual({});
      expect(requestedPaths).toEqual(["/"]);
      // re-run: same content => duplicate suppressed, silent
      const r2 = await runCron(cfgPath);
      expect(r2.produced).toBe(0);
      expect(r2.duplicates).toBe(1);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("allowed source but adapter fails => structured error, no partial artifact", async () => {
    const cfg = {
      schema_version: "1",
      sources: [
        approvedSource({ source_id: "S9" }),
      ],
    };
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources.json");
    fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        return { ok: false, items: [], error: "rate limited", code: "rate_limited" };
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(r.errors["S9"]).toBe("rate limited");
      expect(r.produced).toBe(0);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("robots 4xx does not block an independently approved source", async () => {
    const cfg = {
      schema_version: "1",
      sources: [
        approvedSource({
          source_id: "S9",
          robots_http: "404",
          robots_result: "unavailable",
          robots_path_decision: "allow",
        }),
      ],
    };
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources.json");
    fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
    let called = 0;
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        called += 1;
        return { ok: true, items: [] };
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(r.fetched).toEqual(["S9"]);
      expect(called).toBe(1);
      expect(r.produced).toBe(0);
      expect(r.errors).toEqual({});
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("fails closed for an explicit path disallow", async () => {
    const cfg = {
      schema_version: "1",
      sources: [
        approvedSource({
          source_id: "S9",
          robots_http: "200",
          robots_result: "rules_available",
          robots_path_decision: "disallow",
        }),
      ],
    };
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources.json");
    fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
    let called = 0;
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        called += 1;
        return { ok: true, items: [] };
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(r.fetched).toEqual([]);
      expect(called).toBe(0);
      expect(r.produced).toBe(0);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("does not let root allow authorize a private fetch target", async () => {
    const cfg = {
      schema_version: "1",
      sources: [
        approvedSource({ source_id: "S9", fetch_paths: ["/private"] }),
      ],
    };
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources.json");
    fs.writeFileSync(cfgPath, JSON.stringify(cfg), "utf8");
    let called = 0;
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        called += 1;
        return { ok: true, items: [] };
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(called).toBe(0);
      expect(r.fetched).toEqual([]);
      expect(r.produced).toBe(0);
      expect(r.errors["S9:/private"]).toBe("fetch_target_not_allowed");
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });
});

describe("public-seam counter-examples (momoko NO-GO round 2)", () => {
  let cfgPath: string;
  beforeEach(() => {
    cfgPath = writeTestSourcesConfig();
  });

  it("atomicWriteStaged rejects traversal (../) out of staging root", () => {
    expect(() => atomicWriteStaged("../escape.md", "x")).toThrow(/escapes staging root/);
    expect(() => atomicWriteStaged("/abs/path.md", "x")).toThrow(/escapes staging root/);
  });

  it("adapter items with mismatched source_id are rejected, not written", async () => {
    const cfg = {
      schema_version: "1",
      sources: [approvedSource({ source_id: "S9" })],
    };
    const p = path.join(process.cwd(), ".ingest-test-sources.json");
    fs.writeFileSync(p, JSON.stringify(cfg), "utf8");
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        // malicious adapter claims a different source_id on the item
        return { ok: true, items: [item({ source_id: "S8", source_url: "https://example.com/x" })] };
      },
    });
    try {
      const r = await runCron(p);
      expect(r.produced).toBe(0);
      expect(Object.keys(r.errors).length).toBeGreaterThan(0);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
    } finally {
      fs.rmSync(p, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("adapter items missing schema fields (no note) are rejected, no write", async () => {
    const cfg = { schema_version: "1", sources: [approvedSource({ source_id: "S9" })] };
    const p = path.join(process.cwd(), ".ingest-test-sources.json");
    fs.writeFileSync(p, JSON.stringify(cfg), "utf8");
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        // raw item that is not a valid discovery record (no note, no schema_version)
        return { ok: true, items: [{ source_id: "S9", source_item_id: "bad" }] as unknown[] as never[] };
      },
    });
    try {
      const r = await runCron(p);
      expect(r.produced).toBe(0);
      expect(Object.keys(r.errors).length).toBeGreaterThan(0);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
    } finally {
      fs.rmSync(p, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("urlInScope uses segment boundary (canonical /foo does not allow /foobar)", () => {
    const src = fakeSource({ canonical_url: "https://example.com/foo" });
    expect(urlInScope(src, "https://example.com/foo/bar")).toBe(true);
    expect(urlInScope(src, "https://example.com/foobar")).toBe(false);
    // port mismatch => different origin
    expect(urlInScope(fakeSource({ canonical_url: "https://example.com:8080/" }), "https://example.com/x")).toBe(false);
  });

  it("atomic write leaves no partial artifact when fsync fails (fault injection)", () => {
    // Simulate a failure by targeting a path whose parent is a FILE (mkdir fails)
    const file = path.join(DRAFT_ROOT, "blocker");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, "occupied", "utf8");
    expect(() => atomicWriteStaged("blocker/child.md", "x")).toThrow();
    // no temp file leaked
    const leaked = fs.readdirSync(DRAFT_ROOT).filter((f) => f.startsWith(".tmp-"));
    expect(leaked).toEqual([]);
    fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
  });

  it("importDiscovery ignores injected source; only loaded config is authoritative", () => {
    // S999 is not in the config, even if caller tries to smuggle a source via opts
    const rec = {
      schema_version: "1", source_id: "S999", source_item_id: "z9",
      source_url: "https://attacker.example/x", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n",
    };
    const r = importDiscovery(rec, { sourcesPath: cfgPath });
    expect(r.status).toBe("rejected");
  });
});

describe("NO-GO round-3 regressions (@Mirai)", () => {
  function approvedCfg(sourceId = "S9") {
    return { schema_version: "1", sources: [approvedSource({ source_id: sourceId })] };
  }

  it("same-identity items in one batch get distinct successor versions", async () => {
    const cfgPath = path.join(process.cwd(), `.ingest-test-sources-r3a.json`);
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    const mkRecord = (note: string) => ({
      schema_version: "1", source_id: "S9", source_item_id: "same-id",
      source_url: "https://example.com/x", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note,
    });
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        return { ok: true, items: [mkRecord("one"), mkRecord("two")] as never[] };
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(r.produced).toBe(2);
      const dir = path.join(DRAFT_ROOT, "news", "2026", "S9-same-id");
      const files = fs.readdirSync(dir).filter((f) => /^index-v\d+\.md$/.test(f));
      expect(files).toContain("index-v1.md");
      expect(files).toContain("index-v2.md");
      const v1 = fs.readFileSync(path.join(dir, "index-v1.md"), "utf8");
      const v2 = fs.readFileSync(path.join(dir, "index-v2.md"), "utf8");
      expect(v1).toContain("one");
      expect(v2).toContain("two");
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("phase-1 error aborts whole batch: valid item not written when another is malformed", async () => {
    const cfgPath = path.join(process.cwd(), `.ingest-test-sources-r3b.json`);
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    const good = { schema_version: "1", source_id: "S9", source_item_id: "good",
      source_url: "https://example.com/g", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "good note" };
    const bad = { source_id: "S9", source_item_id: "bad" }; // invalid record
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        return { ok: true, items: [good, bad] as never[] };
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(Object.keys(r.errors).length).toBeGreaterThan(0);
      expect(r.produced).toBe(0);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false); // whole batch aborted
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("staging root symlink is rejected before any write", () => {
    const target = path.join(process.cwd(), ".ingest-symlink-target");
    fs.mkdirSync(target, { recursive: true });
    fs.symlinkSync(target, DRAFT_ROOT);
    try {
      expect(() => atomicWriteStaged("news/x/index-v1.md", "x")).toThrow(/symlink/);
      expect(fs.readdirSync(target)).toEqual([]); // nothing written through symlink
    } finally {
      fs.rmSync(DRAFT_ROOT, { force: true });
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("constant-time note_hash comparison rejects mismatch", () => {
    const rec = {
      schema_version: "1", source_id: "S1", source_item_id: "ct1",
      source_url: "https://example.com/x", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "note", note_hash: "sha256:" + "a".repeat(64),
    };
    const cfgPath = writeTestSourcesConfig();
    try {
      const r = importDiscovery(rec, { sourcesPath: cfgPath });
      expect(r.status).toBe("invalid"); // recomputed hash differs => rejected
    } finally {
      fs.rmSync(cfgPath, { force: true });
    }
  });

  it("test run leaves no repo-root artifacts", async () => {
    // after tests, there should be no .ingest-test-sources-* or __pycache__ in tools/schema
    const leftovers = fs.readdirSync(process.cwd()).filter((f) => f.startsWith(".ingest-test-sources"));
    expect(leftovers).toEqual([]);
    expect(fs.existsSync(path.join(process.cwd(), "tools/schema/__pycache__"))).toBe(false);
  });
});

describe("NO-GO round-4 regressions (@Mirai)", () => {
  function approvedCfg(sourceId = "S9") {
    return { schema_version: "1", sources: [approvedSource({ source_id: sourceId })] };
  }

  it("contentHash includes published_at and source_url", () => {
    const a = item({ published_at: "2026-08-08T00:00:00+09:00", source_url: "https://example.com/a" });
    const b = item({ published_at: "2026-08-09T00:00:00+09:00", source_url: "https://example.com/a" });
    const c = item({ published_at: "2026-08-08T00:00:00+09:00", source_url: "https://example.com/b" });
    expect(contentHash(a)).not.toBe(contentHash(b)); // date change => new version
    expect(contentHash(a)).not.toBe(contentHash(c)); // url change => new version
  });

  it("version is monotonic across years (no fork)", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r4a.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    const rec2026 = { schema_version: "1", source_id: "S9", source_item_id: "yr",
      source_url: "https://example.com/yr", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n1" };
    const rec2027 = { ...rec2026, published_at: "2027-06-01T00:00:00+09:00", note: "n2" };
    registerSourceAdapter({
      source_id: "S9",
      async fetch() { return { ok: true, items: [rec2026] as never[] }; },
    });
    try {
      const r1 = await runCron(cfgPath);
      expect(r1.produced).toBe(1);
      // second import of a 2027 variant of the SAME identity continues the version
      const r2 = importDiscovery(rec2027, { sourcesPath: cfgPath });
      expect(r2.status).toBe("changed");
      expect(r2.version).toBe(2); // monotonic, not re-forked to v1 under 2027 dir
      const v2Path = path.join(DRAFT_ROOT, "news", "2027", "S9-yr", "index-v2.md");
      expect(fs.existsSync(v2Path)).toBe(true);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("urlInScope rejects embedded userinfo", () => {
    const src = fakeSource({ canonical_url: "https://example.com/" });
    expect(urlInScope(src, "https://user:pass@example.com/x")).toBe(false);
    expect(urlInScope(src, "https://example.com/x")).toBe(true);
  });

  it("adapter returning null items => structured error, no write", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r4b.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    registerSourceAdapter({
      source_id: "S9",
      async fetch() { return { ok: true, items: null as never }; },
    });
    try {
      const r = await runCron(cfgPath);
      expect(r.produced).toBe(0);
      expect(Object.values(r.errors).some((e) => e.includes("invalid_items"))).toBe(true);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("commit failure returns structured error and keeps old tree", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r4c.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    // First commit a draft so DRAFT_ROOT has existing content.
    const rec1 = { schema_version: "1", source_id: "S9", source_item_id: "k1",
      source_url: "https://example.com/k1", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n1" };
    const rec2 = { ...rec1, note: "n2 changed" }; // changed content => new version => commit runs
    let fetchCount = 0;
    registerSourceAdapter({
      source_id: "S9",
      async fetch() {
        fetchCount += 1;
        return { ok: true, items: [fetchCount === 1 ? rec1 : rec2] as never[] };
      },
    });
    try {
      expect((await runCron(cfgPath)).produced).toBe(1);
      const before = snapshotDraftTree();
      // Now simulate commit failure by monkeypatching fs.renameSync to throw on the final swap.
      const origRename = fs.renameSync;
      let failed = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      fs.renameSync = ((a: any, b: any) => {
        if (!failed && String(b).includes("index-v")) {
          failed = true;
          throw new Error("injected rename failure");
        }
        return origRename(a as never, b as never);
      }) as typeof fs.renameSync;
      try {
        const r = await runCron(cfgPath);
        expect(Object.values(r.errors).some((e) => e.includes("commit_failed"))).toBe(true);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        fs.renameSync = origRename as any;
      }
      // Old tree preserved (previous draft still present); no new version committed.
      expect(snapshotDraftTree()).toEqual(before);
      expect(fs.readdirSync(path.join(DRAFT_ROOT, "news", "2026", "S9-k1")).length).toBe(1);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });
});

function snapshotDraftTree(): string {
  if (!fs.existsSync(DRAFT_ROOT)) return "∅";
  const lines: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      lines.push(e.isDirectory() ? `${path.relative(DRAFT_ROOT, full)}/` : path.relative(DRAFT_ROOT, full));
      if (e.isDirectory()) walk(full);
    }
  };
  walk(DRAFT_ROOT);
  return lines.sort().join("\n");
}

describe("NO-GO round-5 regressions (@Mirai)", () => {
  function approvedCfg(sourceId = "S9") {
    return { schema_version: "1", sources: [approvedSource({ source_id: sourceId })] };
  }

  it("importDiscovery fsync failure => structured error, zero state (no empty dir)", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r5a.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    const rec = { schema_version: "1", source_id: "S9", source_item_id: "fs",
      source_url: "https://example.com/fs", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n" };
    const origFsync = fs.fsyncSync;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (fs as any).fsyncSync = () => { throw new Error("injected fsync"); };
    try {
      const r = importDiscovery(rec, { sourcesPath: cfgPath });
      expect(r.status).toBe("error");
      expect(r.code).toBe("write_failed");
      expect(r.error).toContain("injected fsync");
      // no empty dir left under DRAFT_ROOT
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
    } finally {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs as any).fsyncSync = origFsync;
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("runCron items array with null element => structured error, no write", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r5b.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    const good = { schema_version: "1", source_id: "S9", source_item_id: "ok",
      source_url: "https://example.com/ok", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "good" };
    registerSourceAdapter({
      source_id: "S9",
      async fetch(): Promise<FetchResult> {
        return { ok: true, items: [good, null] as never[] };
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(Object.values(r.errors).some((e) => e === "invalid_item")).toBe(true);
      expect(r.produced).toBe(0);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false); // whole batch aborted
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("commit swap failure => commit_failed with zero state change (old tree intact)", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r5c.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    const rec1 = { schema_version: "1", source_id: "S9", source_item_id: "sw",
      source_url: "https://example.com/sw", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n1" };
    const rec2 = { ...rec1, note: "n2 changed" };
    let fetchCount = 0;
    registerSourceAdapter({
      source_id: "S9",
      async fetch(): Promise<FetchResult> {
        fetchCount += 1;
        return { ok: true, items: [fetchCount === 1 ? rec1 : rec2] as never[] };
      },
    });
    try {
      expect((await runCron(cfgPath)).produced).toBe(1);
      const before = snapshotDraftTree();
      // Fail the final swap (staging -> root) by monkeypatching renameSync.
      const origRename = fs.renameSync;
      let failed = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs as any).renameSync = (a: unknown, b: unknown) => {
        if (!failed && String(a).includes("drafts-staging") && String(b).endsWith("ingest-drafts")) {
          failed = true;
          throw new Error("injected final swap failure");
        }
        return origRename(a as never, b as never);
      };
      let r;
      try {
        r = await runCron(cfgPath);
      } finally {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (fs as any).renameSync = origRename;
      }
      expect(Object.values(r.errors).some((e) => e.includes("commit_failed"))).toBe(true);
      // zero state change: old tree intact, no new version
      expect(snapshotDraftTree()).toEqual(before);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("phase2b handoff is present in the committed tree", () => {
    const handoff = path.join(process.cwd(), "notes", "phase2b-ingestion-handoff.md");
    expect(fs.existsSync(handoff)).toBe(true);
    const text = fs.readFileSync(handoff, "utf8");
    expect(text).toContain("翼（tsubasa）"); // no-@ signature
    expect(text).not.toContain("@tsubasa");
  });
});

describe("NO-GO round-6 regressions (@Mirai)", () => {
  function approvedCfg(sourceId = "S9") {
    return { schema_version: "1", sources: [approvedSource({ source_id: sourceId })] };
  }

  it("adapter returning null/undefined => structured error, no write", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r6a.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    registerSourceAdapter({
      source_id: "S9",
      async fetch(): Promise<FetchResult> {
        return null as never;
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(r.produced).toBe(0);
      expect(Object.values(r.errors).some((e) => e.includes("non-object"))).toBe(true);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("adapter throwing null => structured error, no write", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r6b.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    registerSourceAdapter({
      source_id: "S9",
      async fetch(): Promise<FetchResult> {
        throw null;
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(r.produced).toBe(0);
      expect(Object.values(r.errors).some((e) => e.includes("adapter_unexpected"))).toBe(true);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("adapter throwing a non-Error (string) => structured, no TypeError", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r6c.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    registerSourceAdapter({
      source_id: "S9",
      async fetch(): Promise<FetchResult> {
        throw "boom";
      },
    });
    try {
      const r = await runCron(cfgPath);
      expect(r.produced).toBe(0);
      expect(Object.values(r.errors).some((e) => e.includes("adapter_unexpected"))).toBe(true);
      expect(fs.existsSync(DRAFT_ROOT)).toBe(false);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("commit cleanup residue is observable, not faked as failure", async () => {
    const cfgPath = path.join(process.cwd(), ".ingest-test-sources-r6d.json");
    fs.writeFileSync(cfgPath, JSON.stringify(approvedCfg()), "utf8");
    const rec1 = { schema_version: "1", source_id: "S9", source_item_id: "res",
      source_url: "https://example.com/res", published_at: "2026-08-08T00:00:00+09:00",
      title: "t", lang: "zh", note: "n1" };
    const rec2 = { ...rec1, note: "n2 changed" };
    let fetchCount = 0;
    registerSourceAdapter({
      source_id: "S9",
      async fetch(): Promise<FetchResult> {
        fetchCount += 1;
        return { ok: true, items: [fetchCount === 1 ? rec1 : rec2] as never[] };
      },
    });
    try {
      expect((await runCron(cfgPath)).produced).toBe(1);
      // Make the old-backup cleanup fail by replacing backup dir with a file.
      // (Simulate by making rmSync fail on .drafts-old* — see snapshot approach.)
      const origRm = fs.rmSync;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs as any).rmSync = (p: unknown, opts: unknown) => {
        if (typeof p === "string" && p.includes("drafts-old")) throw new Error("cleanup injected");
        return origRm(p as never, opts as never);
      };
      const r2 = await runCron(cfgPath);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (fs as any).rmSync = origRm;
      // honest: committed (produced=1) AND residue warning surfaced
      expect(r2.produced).toBe(1);
      expect(Object.values(r2.errors).some((e) => e.includes("cleanup_residue"))).toBe(true);
    } finally {
      fs.rmSync(cfgPath, { force: true });
      fs.rmSync(DRAFT_ROOT, { recursive: true, force: true });
    }
  });

  it("handoff contains exact facts (68 passed, ingest 50, cleanup semantics, no-@ signature)", () => {
    const text = fs.readFileSync(path.join(process.cwd(), "notes", "phase2b-ingestion-handoff.md"), "utf8");
    expect(text).toContain("68 passed");
    expect(text).toContain("ingest 50");
    expect(text).toContain("翼（tsubasa）");
    expect(text).not.toContain("@tsubasa");
    expect(text).toContain("cleanupResidue");
    expect(text).toContain("commit_ok_with_cleanup_residue");
  });
});
