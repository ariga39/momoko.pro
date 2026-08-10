import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
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
  delete env.MOMOKO_CONTENT_PACKAGE_PREVIEW;
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

function serverArtifactText(dir: string): string {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(dir);
  return files
    .filter((file) => /\.(?:html|json|css|js|mjs)$/.test(file))
    .map((file) => fs.readFileSync(file, "utf8"))
    .join("\n");
}

function expectServerArtifact(dir: string): void {
  expect(fs.existsSync(path.join(dir, "_worker.js", "index.js"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "_routes.json"))).toBe(true);
  expect(fs.existsSync(path.join(dir, "_headers"))).toBe(true);
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
    expectServerArtifact(PUBLIC);
    expectServerArtifact(DEFAULT);
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
      // Allow self-hosted /fonts/ woff2 (task #25); forbid remote CDN fonts.
      expect(text).not.toMatch(/fonts\.googleapis|fonts\.gstatic|https?:\/\/[^\s"']+\.(?:woff2?|ttf|otf)\b/i);
      if (file.endsWith(".svg")) {
        expect(path.relative(PUBLIC, file)).toBe("momoko-logo.svg");
      } else {
        expect(file).not.toMatch(/\.(?:png|jpe?g|gif|webp|mp3|wav|ogg|m4a|flac|mp4|webm)$/i);
      }
      expect(file).not.toMatch(/(?:^|[/._-])(?:crawler|cron|deploy|maintenance|research)(?:[/._-]|$)/i);
      expect(text).not.toMatch(/<(?:audio|video|source)\b/i);
      for (const match of text.matchAll(/<img\b[^>]*>/gi)) {
        expect(match[0]).toMatch(/src=["']\/momoko-logo\.svg["']/i);
      }
    }
    const logo = path.join(PUBLIC, "momoko-logo.svg");
    expect(fs.existsSync(logo)).toBe(true);
    expect(createHash("sha256").update(fs.readFileSync(logo)).digest("hex")).toBe(
      "aaa29433b3996850b1c482c4cfe19865294876751d388ee2d1437af62b99dbe7",
    );
    const logoText = fs.readFileSync(logo, "utf8");
    expect(logoText).toContain('viewBox="0 0 1200 220"');
    expect(logoText).toContain("LibreBaskerville-OFL.txt");
    expect(logoText).toContain("Nunito-OFL.txt");
    for (const attribution of ["LibreBaskerville-OFL.txt", "Nunito-OFL.txt"]) {
      const text = fs.readFileSync(path.join(PUBLIC, attribution), "utf8");
      expect(text).toContain("SIL Open Font License, Version 1.1");
    }
    expect(files.filter((file) => /rose/i.test(path.relative(PUBLIC, file)))).toHaveLength(0);
  });

  it("explicit reviewed-current fixture package alone produces one trilingual item", () => {
    const manifest = asRecord(readJson(FIXTURE, "manifest.json"));
    const entries = asArray(manifest.entries);
    expect(entries).toHaveLength(1);
    expect(asRecord(entries[0]).review_status).toBe("published");
    expect(asRecord(asRecord(entries[0]).locales).ja).toBeTruthy();
    expect(asRecord(asRecord(entries[0]).locales).zh).toBeTruthy();
    expect(asRecord(asRecord(entries[0]).locales).en).toBeTruthy();
    expectServerArtifact(FIXTURE);
    const fixtureText = serverArtifactText(FIXTURE);
    expect(fixtureText).toContain("S1-synth-2026-08-08-001");
    expect(fixtureText).not.toContain("S1-synth-2026-08-08-002");
    expect(fixtureText).not.toContain("S1-synth-2026-08-08-003");
  });

  it("keeps the explicit visual DEMO artifact separate from production empty output", () => {
    const publicManifest = asRecord(readJson(PUBLIC, "manifest.json"));
    const visualManifest = asRecord(readJson(VISUAL_FIXTURE, "manifest.json"));
    expect(asArray(publicManifest.entries)).toHaveLength(0);
    expect(asArray(visualManifest.entries)).toHaveLength(1);
    expect(asRecord(asArray(visualManifest.entries)[0]).source_id).toBe("S99");

    expectServerArtifact(PUBLIC);
    expectServerArtifact(VISUAL_FIXTURE);
    const publicText = serverArtifactText(PUBLIC);
    const visualText = serverArtifactText(VISUAL_FIXTURE);
    // Server output keeps route code in the worker; fixture identity is only
    // present in the explicit post-build manifest, never in public output.
    expect(publicText).not.toMatch(/S99-visual-demo-archive-001|visual-fixture-reviewer|example\.invalid/i);
    expect(visualText).toMatch(/S99-visual-demo-archive-001|example\.invalid/i);
    expect(publicText).not.toMatch(/S1-synth-2026-08-08-00[123]/i);
  });

  it("keeps security headers in the empty public artifact", () => {
    const h = fs.readFileSync(path.join(PUBLIC, "_headers"), "utf-8");
    expect(h).toMatch(/Content-Security-Policy/);
    expect(h).toMatch(/X-Content-Type-Options: nosniff/);
    expect(h).toMatch(/frame-ancestors 'none'/);
  });
});
