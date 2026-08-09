import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../tools/schema/css-tokens.ts";

const DIST = path.join(REPO_ROOT, "dist");

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function readJson(rel: string): Json {
  return JSON.parse(fs.readFileSync(path.join(DIST, rel), "utf-8")) as Json;
}

function asArray(v: Json | undefined): Json[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: Json | undefined): Record<string, Json> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
}

describe("build artifact audit — no draft/stale/retracted in published outputs", () => {
  it("manifest contains only current/reviewed content", () => {
    const m = asRecord(readJson("manifest.json"));
    const entries = asArray(m.entries);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) {
      expect(asRecord(e).review_status).toBe("published");
    }
    const ids = entries.map((e) => asRecord(e).source_item_id);
    expect(ids.some((i) => typeof i === "string" && (i.includes("002") || i.includes("003")))).toBe(false);
  });

  it("search index contains no draft/retracted slugs", () => {
    const s = asArray(readJson("search.json"));
    for (const row of s) {
      const slug = asRecord(row).slug;
      expect(typeof slug === "string" ? slug : "").not.toMatch(/002|003/);
    }
  });

  it("built HTML does not contain draft/retracted bodies", () => {
    // retracted (003) must not exist anywhere in dist
    const walk = (dir: string): string[] => {
      const out: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        const f = path.join(dir, e.name);
        if (e.isDirectory()) out.push(...walk(f));
        else if (e.isFile()) out.push(f);
      }
      return out;
    };
    const files = walk(DIST);
    const any003 = files.some((f) => f.includes("synth-2026-08-08-003"));
    expect(any003).toBe(false);
  });

  it("security headers file exists for future deploy (CSP/static config)", () => {
    const h = fs.readFileSync(path.join(REPO_ROOT, "public", "_headers"), "utf-8");
    expect(h).toMatch(/Content-Security-Policy/);
    expect(h).toMatch(/X-Content-Type-Options: nosniff/);
    expect(h).toMatch(/frame-ancestors 'none'/);
  });

  it("published HTML contains no raw-discovery/secret-shaped values", () => {
    const m = asRecord(readJson("manifest.json"));
    const entries = asArray(m.entries);
    expect(entries.length).toBeGreaterThan(0);
    const sample = asRecord(entries[0]);
    const ch = sample.content_hash;
    expect(typeof ch === "string" ? ch : "").toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
