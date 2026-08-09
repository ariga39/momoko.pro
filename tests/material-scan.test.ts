import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { REPO_ROOT, scanOutOfBoundsMaterial } from "../tools/schema/material-scan.ts";

describe("版权/素材越界扫描", () => {
  it("content fixtures contain no official media / lyrics / transcripts", () => {
    const violations = scanOutOfBoundsMaterial();
    expect(violations).toEqual([]);
  });

  it("flags a synthetic file that embeds an official image or lyrics", () => {
    const dir = path.join(REPO_ROOT, "content", "news", "2026", "S1-synth-scan-probe");
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, "index.md");
    fs.writeFileSync(
      file,
      "---\nschema_version: '1'\nkind: news\n---\n\n![official](https://x.example/a.png)\n",
    );
    try {
      const violations = scanOutOfBoundsMaterial();
      expect(violations.some((v) => v.endsWith("S1-synth-scan-probe/index.md"))).toBe(true);
    } finally {
      fs.rmSync(path.dirname(file), { recursive: true, force: true });
    }
  });
});
