import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { loadVisualCatalog } from "../src/lib/visual-demo.ts";
import { getContentRoot } from "../src/lib/content.ts";
import { validateFile } from "../tools/schema/validate.ts";

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
  });

  it("keeps PUBLIC_BUILD on the production empty package even when a DEMO override is requested", () => {
    process.env.MOMOKO_CONTENT_PACKAGE_ROOT = "tests/fixtures/content-package/visual-demo";
    process.env.MOMOKO_CONTENT_PACKAGE_MODE = "test";
    process.env.PUBLIC_BUILD = "1";
    expect(() => getContentRoot()).toThrow(/public build cannot use a content override/);
    expect(loadVisualCatalog().mode).toBe("empty");
    expect(loadVisualCatalog().songsLive).toEqual([]);
  });
});

describe("Phase 4A progressive-enhancement contract", () => {
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
