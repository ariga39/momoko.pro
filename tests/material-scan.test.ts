import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { getContentRoot } from "../src/lib/content.ts";
import { scanOutOfBoundsMaterial } from "../tools/schema/material-scan.ts";

describe("版权/素材越界扫描", () => {
  it("content fixtures contain no official media / lyrics / transcripts", () => {
    const violations = scanOutOfBoundsMaterial(getContentRoot());
    expect(violations).toEqual([]);
  });

  it("flags a synthetic file that embeds an official image or lyrics", () => {
    // Place probe OUTSIDE content/news/ so it never races with loadNews()
    // scans in parallel test files. scanOutOfBoundsMaterial walks all of content/.
    const dir = path.join(getContentRoot(), "_probe");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "probe.md");
    fs.writeFileSync(
      file,
      "---\nschema_version: '1'\nkind: news\n---\n\n![official](https://x.example/a.png)\n",
    );
    try {
      const violations = scanOutOfBoundsMaterial(getContentRoot());
      expect(violations.some((v) => v.endsWith("_probe/probe.md"))).toBe(true);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});
