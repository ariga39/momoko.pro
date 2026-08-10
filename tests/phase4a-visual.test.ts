import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadVisualCatalog } from "../src/lib/visual-demo.ts";
import { getContentRoot, loadNews, readContentPackageManifest } from "../src/lib/content.ts";
import { collectContentFiles, validateContentFile, validateFile } from "../tools/schema/validate.ts";

const root = path.resolve(process.cwd());
const demoRoot = path.join(root, "tests/fixtures/content-package/visual-demo");
const originalRoot = process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
const originalMode = process.env.MOMOKO_CONTENT_PACKAGE_MODE;
const originalPublic = process.env.PUBLIC_BUILD;

afterEach(() => {
  if (originalRoot === undefined) delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
  else process.env.MOMOKO_CONTENT_PACKAGE_ROOT = originalRoot;
  if (originalMode === undefined) delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
  else process.env.MOMOKO_CONTENT_PACKAGE_MODE = originalMode;
  if (originalPublic === undefined) delete process.env.PUBLIC_BUILD;
  else process.env.PUBLIC_BUILD = originalPublic;
});

describe("Phase 4A visual package boundary", () => {
  it("accepts the explicit schema-valid three-locale DEMO catalog", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(demoRoot, "package.json"), "utf8"));
    const catalog = JSON.parse(fs.readFileSync(path.join(demoRoot, "visual-catalog.json"), "utf8"));
    expect(validateFile("content-package.schema.json", manifest).valid).toBe(true);
    expect(validateFile("visual-catalog.schema.json", catalog).valid).toBe(true);
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/visual-demo";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    expect(loadVisualCatalog().mode).toBe("demo");
    expect(loadVisualCatalog().notice.zh).toMatch(/DEMO/);
    const news = loadNews();
    expect(news.length).toBeGreaterThanOrEqual(1);
    expect(news.every((item) => item.canonical.title.includes("DEMO") || item.canonicalBody.includes("DEMO"))).toBe(true);
    for (const file of collectContentFiles(demoRoot)) {
      expect(validateContentFile(file).valid, `${file.path} must satisfy its content schema`).toBe(true);
    }
  });

  it("rejects a DEMO override in PUBLIC_BUILD instead of disguising it as empty", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/visual-demo";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    process.env.PUBLIC_BUILD = "1";
    expect(() => getContentRoot()).toThrow(/public build cannot use a content override/);
    expect(() => loadVisualCatalog()).toThrow(/public build cannot use a content override/);
  });

  it("uses the real checked-in empty package for an unconfigured PUBLIC_BUILD", () => {
    delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
    delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
    process.env.PUBLIC_BUILD = "1";
    expect(loadVisualCatalog().mode).toBe("empty");
    expect(loadVisualCatalog().songsLive).toEqual([]);
  });

  it("does not allow an empty manifest to declare a visual catalog", () => {
    expect(
      validateFile("content-package.schema.json", {
        package_version: "1",
        content_schema_version: "1",
        status: "empty",
        visual_catalog: "visual-catalog.json",
      }).valid,
    ).toBe(false);
  });

  it("does not accept a caller-supplied manifest root, including ready visual content", () => {
    delete process.env.MOMOKO_CONTENT_PACKAGE_ROOT;
    delete process.env.MOMOKO_CONTENT_PACKAGE_MODE;
    delete process.env.PUBLIC_BUILD;
    const callerRoot = fs.mkdtempSync(path.join(path.dirname(demoRoot), ".caller-manifest-"));
    fs.writeFileSync(
      path.join(callerRoot, "package.json"),
      JSON.stringify({
        package_version: "1",
        content_schema_version: "1",
        status: "ready",
        visual_catalog: "visual-catalog.json",
      }),
    );
    fs.writeFileSync(path.join(callerRoot, "visual-catalog.json"), "{}");
    try {
      const readWithExtraArgument = readContentPackageManifest as unknown as (root: string) => unknown;
      expect(readWithExtraArgument(callerRoot)).toMatchObject({ status: "empty" });
    } finally {
      fs.rmSync(callerRoot, { recursive: true, force: true });
    }
  });

  it("rejects a future ready visual package at the production boundary", () => {
    const manifest = {
      package_version: "1",
      content_schema_version: "1",
      status: "ready",
      visual_catalog: "visual-catalog.json",
    };
    expect(validateFile("content-package.schema.json", manifest).valid).toBe(true);
    const futureRoot = fs.mkdtempSync(path.join(path.dirname(demoRoot), ".future-ready-visual-"));
    fs.writeFileSync(path.join(futureRoot, "package.json"), JSON.stringify(manifest));
    fs.writeFileSync(path.join(futureRoot, "visual-catalog.json"), "{}");
    try {
      process.env.MOMOKO_CONTENT_PACKAGE_ROOT = path.relative(process.cwd(), futureRoot);
      process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
      process.env.PUBLIC_BUILD = "1";
      expect(() => loadNews()).toThrow(/public build cannot use a content override/);
    } finally {
      fs.rmSync(futureRoot, { recursive: true, force: true });
    }
  });

  it("rejects a default ready visual package in an isolated production process", () => {
    const isolatedRoot = fs.mkdtempSync(path.join(os.tmpdir(), "phase4a-default-boundary-"));
    const copy = (relativePath: string) => {
      const source = path.join(root, relativePath);
      const destination = path.join(isolatedRoot, relativePath);
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.copyFileSync(source, destination);
    };
    copy("src/lib/content.ts");
    copy("tools/schema/validate.ts");
    for (const entry of fs.readdirSync(path.join(root, "schemas"))) {
      if (entry.endsWith(".schema.json")) copy(path.join("schemas", entry));
    }
    fs.mkdirSync(path.join(isolatedRoot, "content"), { recursive: true });
    fs.writeFileSync(
      path.join(isolatedRoot, "package.json"),
      JSON.stringify({ type: "module" }),
    );
    fs.writeFileSync(
      path.join(isolatedRoot, "content", "package.json"),
      JSON.stringify({
        package_version: "1",
        content_schema_version: "1",
        status: "ready",
        visual_catalog: "visual-catalog.json",
      }),
    );
    fs.writeFileSync(path.join(isolatedRoot, "content", "visual-catalog.json"), "{}");
    fs.symlinkSync(path.join(root, "node_modules"), path.join(isolatedRoot, "node_modules"), "dir");
    try {
      const script = `
        import { loadNews, readContentPackageManifest } from "./src/lib/content.ts";
        for (const [label, operation] of [["manifest", readContentPackageManifest], ["news", loadNews]]) {
          try {
            operation();
            console.log(label + ":unexpected_success");
            process.exitCode = 1;
          } catch (error) {
            console.log(label + ":" + (error && typeof error === "object" ? error.code : "unknown"));
          }
        }
      `;
      const env = { ...process.env };
      delete env.MOMOKO_CONTENT_PACKAGE_ROOT;
      delete env.MOMOKO_CONTENT_PACKAGE_MODE;
      delete env.PUBLIC_BUILD;
      const output = execFileSync(
        process.execPath,
        ["--experimental-strip-types", "--input-type=module", "-e", script],
        { cwd: isolatedRoot, env, encoding: "utf8" },
      );
      expect(output.trim().split(/\r?\n/)).toEqual([
        "manifest:visual_catalog_mode_required",
        "news:visual_catalog_mode_required",
      ]);
    } finally {
      fs.rmSync(isolatedRoot, { recursive: true, force: true });
    }
  });
});

describe("Phase 4A progressive-enhancement contract", () => {
  it("keeps stable Momoko content outside the DEMO catalog and demotes policy to the footer", () => {
    const layout = fs.readFileSync(path.join(root, "src/components/SiteLayout.astro"), "utf8");
    const home = fs.readFileSync(path.join(root, "src/pages/[lang].astro"), "utf8");
    const about = fs.readFileSync(path.join(root, "src/pages/[lang]/about/index.astro"), "utf8");

    const navBlock = layout.match(/const nav = \[([\s\S]*?)\];/)?.[1] ?? "";
    expect(navBlock).not.toContain("/source-policy/");
    expect(layout).toMatch(/href=\{getRelativeLocaleUrl\(lang, "\/source-policy\/"\)\}/);
    expect(home).toContain("profile-section");
    expect(home).toContain("millionlive-anime.idolmaster-official.jp/character/momoko/");
    expect(home.indexOf("profile-section")).toBeLessThan(home.indexOf("<DemoNotice"));
    expect(about).not.toContain("DemoNotice");
  });

  it("has a native details mobile menu with JS focus return, not dialog semantics", () => {
    const layout = fs.readFileSync(path.join(root, "src/components/SiteLayout.astro"), "utf8");
    expect(layout).toMatch(/<details[^>]+data-mobile-menu/);
    expect(layout).toMatch(/Escape/);
    expect(layout).toMatch(/focus\(\)/);
    expect(layout).not.toMatch(/role=["']dialog["']/);
  });

  it("parses and serializes URL-backed filters deterministically", async () => {
    const { parseFilterQuery, serializeFilterQuery } = await import("../src/lib/url-filter.ts");
    expect(parseFilterQuery("?year=2025&type=live")).toEqual({ year: "2025", type: "live" });
    expect(serializeFilterQuery({ year: "2025", type: "live" })).toBe("?type=live&year=2025");
    expect(serializeFilterQuery({ year: "", type: "all" })).toBe("");
  });
});
