import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  REPO_ROOT,
  dspdateToIsoJst,
  loadItem,
  loadProfile,
  materializeSinglePage,
  type SinglePageItem,
} from "../tools/ingest/single-page/materialize.ts";
import { validateFile } from "../tools/schema/validate.ts";

const PROFILES = path.join(REPO_ROOT, "config", "single-page-profiles.json");
const S6_ITEM = path.join(REPO_ROOT, "tools", "ingest", "single-page", "items", "S6-01_18661.json");
const SYN_PROFILE = path.join(REPO_ROOT, "tests", "fixtures", "single-page", "synthetic-profile.json");
const SYN_ITEM = path.join(REPO_ROOT, "tests", "fixtures", "single-page", "synthetic-item.json");

const temps: string[] = [];

function tempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momoko-sp-"));
  temps.push(root);
  return root;
}

afterEach(() => {
  for (const root of temps) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
  }
  temps.length = 0;
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

describe("single-page profile/item schemas", () => {
  it("S6 profile and S9 synthetic profile validate", () => {
    for (const p of [PROFILES, SYN_PROFILE]) {
      const raw = JSON.parse(fs.readFileSync(p, "utf8"));
      for (const entry of raw.profiles) {
        const r = validateFile("single-page-profile.schema.json", entry);
        expect(r.valid, `${p}: ${r.errors}`).toBe(true);
      }
    }
  });

  it("S6 item and S9 synthetic item validate", () => {
    for (const p of [S6_ITEM, SYN_ITEM]) {
      const r = validateFile("single-page-item.schema.json", JSON.parse(fs.readFileSync(p, "utf8")));
      expect(r.valid, `${p}: ${r.errors}`).toBe(true);
    }
  });
});

describe("dspdate conversion", () => {
  it("converts YYYY/MM/DD HH:mm to ISO instant with JST offset", () => {
    expect(dspdateToIsoJst("2026/05/25 21:00")).toBe("2026-05-25T21:00:00+09:00");
    expect(dspdateToIsoJst("2026/06/01 09:30")).toBe("2026-06-01T09:30:00+09:00");
  });
  it("fails closed on a malformed dspdate", () => {
    expect(() => dspdateToIsoJst("25/05/2026 21:00")).toThrow(/does not match/);
    expect(() => dspdateToIsoJst("2026-05-25T21:00")).toThrow(/does not match/);
  });
});

describe("generic materializer — S6 (single generic entry, no per-news code)", () => {
  it("materializes ja canonical + zh/en drafts, all draft, zero-diff rerun", () => {
    const root = tempRoot();
    const item = loadItem(S6_ITEM);
    const first = materializeSinglePage("S6", item, root);
    expect(first.ok).toBe(true);
    expect(first.changed).toBe(true);
    expect(first.contentPath).toBe("content/news/2026/S6-01_18661");
    const dir = path.join(root, "content", "news", "2026", "S6-01_18661");
    for (const f of ["content.ja.md", "content.zh.md", "content.en.md", "editorial-history.json"]) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
    const ja = fs.readFileSync(path.join(dir, "content.ja.md"), "utf8");
    expect(ja).toContain("is_canonical: true");
    expect(ja).toContain("review_status: draft");
    for (const f of ["content.zh.md", "content.en.md"]) {
      const t = fs.readFileSync(path.join(dir, f), "utf8");
      expect(t).toContain("is_canonical: false");
      expect(t).toContain("review_status: draft");
      expect(t).toContain('content_path: content/news/2026/S6-01_18661/content.ja.md');
    }

    const before = snapshotTree(root);
    const second = materializeSinglePage("S6", item, root);
    expect(second.ok).toBe(true);
    expect(second.changed).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("no .ingest-drafts or raw HTML/residue is left in the output", () => {
    const root = tempRoot();
    materializeSinglePage("S6", loadItem(S6_ITEM), root);
    const all = listFiles(root);
    expect(all.some((f) => f.includes(".ingest-drafts"))).toBe(false);
    expect(all.some((f) => f.endsWith(".html"))).toBe(false);
    expect(all.some((f) => f.includes("response"))).toBe(false);
  });

  it("profile canonical_url must equal item page_url (fail closed)", () => {
    const item = loadItem(S6_ITEM);
    const item2 = { ...item, page_url: "https://idolmaster-official.jp/news/01_99999.html" };
    const r = materializeSinglePage("S6", item2, tempRoot());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/must equal the frozen canonical page/);
  });

  it("selector const mismatch fails closed with zero writes", () => {
    const item = loadItem(S6_ITEM) as SinglePageItem;
    const bad = {
      ...item,
      extracted: { ...item.extracted, lng: "en" },
    };
    const root = tempRoot();
    const r = materializeSinglePage("S6", bad, root);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/lng must equal ja/);
    expect(listFiles(root)).toEqual([]);
  });

  it("missing extracted field fails closed", () => {
    const item = loadItem(S6_ITEM) as SinglePageItem;
    const bad = { ...item, extracted: { ...item.extracted } } as SinglePageItem;
    delete (bad.extracted as Record<string, string>).title;
    const r = materializeSinglePage("S6", bad, tempRoot());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/extracted field missing: title/);
  });

  it("source_lang must equal the selector lang (declared by metadata)", () => {
    const item = loadItem(S6_ITEM) as SinglePageItem;
    const bad = { ...item, source_lang: "en" as const };
    const r = materializeSinglePage("S6", bad, tempRoot());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/source_lang/);
  });

  it("unknown source profile fails closed", () => {
    const r = materializeSinglePage("S999", loadItem(S6_ITEM), tempRoot());
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/profile not found/);
  });
});

describe("generic materializer — second synthetic item proves NO new code", () => {
  it("handles a different URL/title/date/language via the same entry and data only", () => {
    const root = tempRoot();
    const item = loadItem(SYN_ITEM);
    const first = materializeSinglePage("S9", item, root, SYN_PROFILE);
    expect(first.ok).toBe(true);
    expect(first.changed).toBe(true);
    expect(first.contentPath).toBe("content/news/2026/S9-announce-2026");
    const dir = path.join(root, "content", "news", "2026", "S9-announce-2026");
    for (const f of ["content.en.md", "content.ja.md", "content.zh.md", "editorial-history.json"]) {
      expect(fs.existsSync(path.join(dir, f))).toBe(true);
    }
    const en = fs.readFileSync(path.join(dir, "content.en.md"), "utf8");
    expect(en).toContain("is_canonical: true");
    expect(en).toContain("lang: en");
    expect(en).toContain("Synthetic Second Item");
    // second run zero diff
    const before = snapshotTree(root);
    const second = materializeSinglePage("S9", item, root, SYN_PROFILE);
    expect(second.changed).toBe(false);
    expect(snapshotTree(root)).toEqual(before);
  });

  it("proves item identity/title live only in data files, never in production TS", () => {
    // Static scan of the generic materializer source: no S6/S9 item ids, titles,
    // or frozen URLs may be hardcoded in tools/ingest/single-page/**.
    const dir = path.join(REPO_ROOT, "tools", "ingest", "single-page");
    const tsFiles: string[] = [];
    const walk = (p: string) => {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const full = path.join(p, e.name);
        if (e.isDirectory()) walk(full);
        else if (e.name.endsWith(".ts")) tsFiles.push(full);
      }
    };
    walk(dir);
    const combined = tsFiles.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    for (const needle of [
      "01_18661",
      "idolmaster-official.jp",
      "Synthetic Second Item",
      "announce-2026",
      "2026/05/25 21:00",
    ]) {
      expect(combined).not.toContain(needle);
    }
  });
});

describe("legacy index.md / canonical integrity fail closed", () => {
  it("loader rejects a legacy index.md in a bundle", async () => {
    const { loadNews } = await import("../src/lib/content.ts");
    // Build a temp content package under the allowed test fixture root with a
    // legacy index.md; loadNews must fail closed on it.
    const fixtureBase = path.join(REPO_ROOT, "tests", "fixtures", "content-package");
    const contentRoot = path.join(fixtureBase, "legacy-index-probe");
    const bundle = path.join(contentRoot, "news", "2026", "S1-legacy");
    fs.rmSync(contentRoot, { recursive: true, force: true });
    fs.mkdirSync(bundle, { recursive: true });
    fs.writeFileSync(path.join(bundle, "index.md"), "---\nlang: ja\nis_canonical: true\n---\nbody");
    fs.writeFileSync(
      path.join(contentRoot, "package.json"),
      JSON.stringify({ package_version: "1", content_schema_version: "1", status: "ready" }),
    );
    try {
      process.env.MOMOKO_CONTENT_PACKAGE_ROOT = path.relative(REPO_ROOT, contentRoot);
      process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
      expect(() => loadNews()).toThrow(/legacy index\.md is not allowed/);
    } finally {
      delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
      delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
      fs.rmSync(contentRoot, { recursive: true, force: true });
    }
  });

  it("validator requires is_canonical on every content file", async () => {
    const { collectContentFiles, validateContentFile, schemaForContentFile } = await import("../tools/schema/validate.ts");
    // S6 bundle files are all valid (is_canonical present).
    const s6 = collectContentFiles().filter((f) => f.path.includes("S6-01_18661"));
    expect(s6.length).toBeGreaterThan(0);
    for (const f of s6) {
      expect(validateContentFile(f).valid, f.path).toBe(true);
    }
    // A file without is_canonical must fail schemaForContentFile.
    expect(() => schemaForContentFile({ path: "content/news/x/content.ja.md", data: { lang: "ja", title: "t" } })).toThrow(/is_canonical/);
  });

  it("editorial read rejects a bundle without exactly one canonical file", async () => {
    const { readEditorialBundle } = await import("../tools/editorial/editorial.ts");
    const root = tempRoot();
    const dir = path.join(root, "content", "news", "2026", "S1-broken");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "content.ja.md"), "---\nis_canonical: true\nlang: ja\n---\nbody");
    fs.writeFileSync(path.join(dir, "content.en.md"), "---\nis_canonical: true\nlang: en\n---\nbody");
    fs.writeFileSync(path.join(dir, "editorial-history.json"), JSON.stringify({ history_version: "1", identity: "S1|broken", events: [] }));
    const r = readEditorialBundle(root, "content/news/2026/S1-broken");
    expect(r.ok).toBe(false);
  });

  it("S6 profile is automated_fetch=false and config sources S1-S6 all manual", async () => {
    const { loadSources } = await import("../tools/ingest/ingest.ts");
    const profile = loadProfile("S6");
    expect(profile?.automated_fetch).toBe(false);
    const sources = loadSources();
    expect(sources.every((s) => s.automated_fetch === false)).toBe(true);
  });
});
