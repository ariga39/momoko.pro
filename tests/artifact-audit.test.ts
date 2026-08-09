import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { REPO_ROOT } from "../tools/schema/css-tokens.ts";

const PUBLIC = path.join(REPO_ROOT, "dist-public");
const DEFAULT = path.join(REPO_ROOT, "dist");
const FIXTURE = path.join(REPO_ROOT, "dist-fixture");
const VISUAL_FIXTURE = path.join(REPO_ROOT, "dist-visual-fixture");
const FIXTURE_ROOT = "tests/fixtures/content-package/synthetic";
const VISUAL_FIXTURE_ROOT = "tests/fixtures/content-package/visual-demo";

type Json = null | boolean | number | string | Json[] | { [k: string]: Json };

function productionEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.MOMOKO_CONTENT_PACKAGE_ROOT;
  delete env.MOMOKO_CONTENT_PACKAGE_MODE;
  delete env.MOMOKO_BUILD_OUT_DIR;
  return env;
}

function fixtureEnv(): NodeJS.ProcessEnv {
  return {
    ...productionEnv(),
    MOMOKO_CONTENT_PACKAGE_MODE: "test",
    MOMOKO_CONTENT_PACKAGE_ROOT: FIXTURE_ROOT,
  };
}

function visualFixtureEnv(): NodeJS.ProcessEnv {
  return {
    ...productionEnv(),
    MOMOKO_CONTENT_PACKAGE_MODE: "test",
    MOMOKO_CONTENT_PACKAGE_ROOT: VISUAL_FIXTURE_ROOT,
  };
}

function readJson(dir: string, rel: string): Json {
  return JSON.parse(fs.readFileSync(path.join(dir, rel), "utf-8")) as Json;
}

function asArray(v: Json | undefined): Json[] {
  return Array.isArray(v) ? v : [];
}

function asRecord(v: Json | undefined): Record<string, Json> {
  return v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, Json>) : {};
}

describe("production artifact boundary", () => {
  beforeAll(() => {
    for (const dir of [PUBLIC, DEFAULT, FIXTURE, VISUAL_FIXTURE]) fs.rmSync(dir, { recursive: true, force: true });
    execFileSync("pnpm", ["build:public"], { cwd: REPO_ROOT, env: productionEnv(), stdio: "pipe" });
    execFileSync("pnpm", ["build"], { cwd: REPO_ROOT, env: productionEnv(), stdio: "pipe" });

    // The fixture build is deliberately explicit and isolated. It proves that
    // a reviewed-current package can enter the static seam without making the
    // normal production build inherit synthetic content.
    execFileSync("pnpm", ["exec", "astro", "build", "--outDir", "dist-fixture"], {
      cwd: REPO_ROOT,
      env: fixtureEnv(),
      stdio: "pipe",
    });
    execFileSync("node", ["--experimental-strip-types", "tools/schema/postbuild.ts"], {
      cwd: REPO_ROOT,
      env: { ...fixtureEnv(), MOMOKO_BUILD_OUT_DIR: "dist-fixture" },
      stdio: "pipe",
    });
    execFileSync("pnpm", ["exec", "astro", "build", "--outDir", "dist-visual-fixture"], {
      cwd: REPO_ROOT,
      env: visualFixtureEnv(),
      stdio: "pipe",
    });
    execFileSync("node", ["--experimental-strip-types", "tools/schema/postbuild.ts"], {
      cwd: REPO_ROOT,
      env: { ...visualFixtureEnv(), MOMOKO_BUILD_OUT_DIR: "dist-visual-fixture" },
      stdio: "pipe",
    });
  });

  afterAll(() => {
    for (const dir of [PUBLIC, DEFAULT, FIXTURE, VISUAL_FIXTURE]) fs.rmSync(dir, { recursive: true, force: true });
  });

  it("default production package is a truthful empty site", () => {
    const manifest = asRecord(readJson(PUBLIC, "manifest.json"));
    expect(asArray(manifest.entries)).toHaveLength(0);
    expect(asArray(readJson(PUBLIC, "search.json"))).toHaveLength(0);
    expect(fs.existsSync(path.join(PUBLIC, "zh", "news", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(DEFAULT, "zh", "news", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(PUBLIC, "zh", "news", "2026"))).toBe(false);
    expect(fs.existsSync(path.join(DEFAULT, "zh", "news", "2026"))).toBe(false);
  });

  it("production output contains no synthetic/demo markers or external scripts", () => {
    execFileSync(
      "node",
      ["--experimental-strip-types", "tools/schema/public-audit.mjs", "dist-public"],
      { cwd: REPO_ROOT, env: productionEnv(), stdio: "pipe" },
    );
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.isFile()) files.push(full);
      }
    };
    walk(PUBLIC);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      expect(text).not.toMatch(/synthetic|合成夹具|demo news|fake news/i);
      expect(text).not.toMatch(/<script[^>]+src=["']https?:\/\//i);
      expect(file).not.toMatch(/\.(?:png|jpe?g|gif|webp|svg|mp3|wav|ogg|m4a|flac|mp4|webm)$/i);
      expect(file).not.toMatch(/(?:^|[/._-])(?:crawler|cron|deploy|maintenance|research)(?:[/._-]|$)/i);
      expect(text).not.toMatch(/<(?:img|audio|video|source)\b/i);
    }
  });

  it("explicit reviewed-current fixture package alone produces one trilingual item", () => {
    const manifest = asRecord(readJson(FIXTURE, "manifest.json"));
    const entries = asArray(manifest.entries);
    expect(entries).toHaveLength(1);
    expect(asRecord(entries[0]).review_status).toBe("published");
    expect(asRecord(asRecord(entries[0]).locales).ja).toBeTruthy();
    expect(asRecord(asRecord(entries[0]).locales).zh).toBeTruthy();
    expect(asRecord(asRecord(entries[0]).locales).en).toBeTruthy();
    expect(fs.existsSync(path.join(FIXTURE, "zh", "news", "2026", "S1-synth-2026-08-08-001", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(FIXTURE, "zh", "news", "2026", "S1-synth-2026-08-08-002", "index.html"))).toBe(false);
  });

  it("keeps the explicit visual DEMO artifact separate from production empty output", () => {
    const publicManifest = asRecord(readJson(PUBLIC, "manifest.json"));
    const visualManifest = asRecord(readJson(VISUAL_FIXTURE, "manifest.json"));
    expect(asArray(publicManifest.entries)).toHaveLength(0);
    expect(asArray(visualManifest.entries)).toHaveLength(1);
    expect(asRecord(asArray(visualManifest.entries)[0]).source_id).toBe("S99");

    const publicText = fs.readFileSync(path.join(PUBLIC, "zh", "index.html"), "utf8");
    const visualText = fs.readFileSync(path.join(VISUAL_FIXTURE, "zh", "index.html"), "utf8");
    expect(publicText).not.toMatch(/DEMO|S99-visual-demo-archive-001|visual-fixture-reviewer|example\.invalid/i);
    expect(visualText).toMatch(/DEMO|S99-visual-demo-archive-001|visual-fixture-reviewer|example\.invalid/i);
    expect(fs.existsSync(path.join(PUBLIC, "en", "songs-live", "index.html"))).toBe(true);
    expect(fs.existsSync(path.join(VISUAL_FIXTURE, "en", "songs-live", "index.html"))).toBe(true);
    expect(fs.readFileSync(path.join(VISUAL_FIXTURE, "en", "songs-live", "index.html"), "utf8")).toMatch(/DEMO/);
  });

  it("keeps security headers in the empty public artifact", () => {
    const h = fs.readFileSync(path.join(PUBLIC, "_headers"), "utf-8");
    expect(h).toMatch(/Content-Security-Policy/);
    expect(h).toMatch(/X-Content-Type-Options: nosniff/);
    expect(h).toMatch(/frame-ancestors 'none'/);
  });
});
