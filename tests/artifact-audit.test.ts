import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT } from "../tools/schema/css-tokens.ts";

const PUBLIC = path.join(REPO_ROOT, "dist-public");
const DEFAULT = path.join(REPO_ROOT, "dist");

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function readJson(dir: string, rel: string): Json {
  return JSON.parse(fs.readFileSync(path.join(dir, rel), "utf-8")) as Json;
}

function asArray(v: Json | undefined): Json[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: Json | undefined): Record<string, Json> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
}

describe("public build artifact audit — deploy-ready excludes draft/stale/retracted", () => {
  // Ensure a fresh public-only build exists before auditing.
  execFileSync("pnpm", ["build:public"], { cwd: REPO_ROOT, stdio: "pipe" });

  it("public manifest contains only current/reviewed content", () => {
    const m = asRecord(readJson(PUBLIC, "manifest.json"));
    const entries = asArray(m.entries);
    expect(entries.length).toBeGreaterThan(0);
    for (const e of entries) expect(asRecord(e).review_status).toBe("published");
    const ids = entries.map((e) => asRecord(e).source_item_id);
    expect(ids.some((i) => typeof i === "string" && (i.includes("002") || i.includes("003")))).toBe(false);
  });

  it("public search index contains no draft/retracted slugs", () => {
    const s = asArray(readJson(PUBLIC, "search.json"));
    for (const row of s) {
      const slug = asRecord(row).slug;
      expect(typeof slug === "string" ? slug : "").not.toMatch(/002|003/);
    }
  });

  it("public build has no draft/stale/retracted detail/body and no raw/secret-shaped values", () => {
    execFileSync(
      "node",
      ["--experimental-strip-types", "tools/schema/public-audit.mjs", "dist-public"],
      { cwd: REPO_ROOT, stdio: "pipe" },
    );
  });

  it("security headers file is present in the public artifact", () => {
    const h = fs.readFileSync(path.join(PUBLIC, "_headers"), "utf-8");
    expect(h).toMatch(/Content-Security-Policy/);
    expect(h).toMatch(/X-Content-Type-Options: nosniff/);
    expect(h).toMatch(/frame-ancestors 'none'/);
  });

  it("default local build still renders draft preview (approved behavior), public build does not", () => {
    // default build keeps the accepted noindex preview for draft (002)
    const defaultHasDraft = fs.existsSync(
      path.join(DEFAULT, "zh", "news", "2026", "S1-synth-2026-08-08-002", "index.html"),
    );
    const publicHasDraft = fs.existsSync(
      path.join(PUBLIC, "zh", "news", "2026", "S1-synth-2026-08-08-002", "index.html"),
    );
    expect(defaultHasDraft).toBe(true);
    expect(publicHasDraft).toBe(false);
  });
});
