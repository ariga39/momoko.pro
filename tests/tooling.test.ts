import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const ROOT = path.resolve(fileURLToPath(new URL("..", import.meta.url)));

function readJson(relativePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(path.join(ROOT, relativePath), "utf8")) as Record<
    string,
    unknown
  >;
}

describe("static quality gates", () => {
  it("keeps TypeScript strictest explicit and covers Astro plus tooling", () => {
    const config = readJson("tsconfig.json");
    const compilerOptions = config.compilerOptions as Record<string, unknown>;
    const include = config.include as string[];

    expect(config.extends).toBe("astro/tsconfigs/strictest");
    expect(compilerOptions.strict).toBe(true);
    expect(include).toEqual(
      expect.arrayContaining(["src/**/*.astro", "tools/**/*.ts", "e2e/**/*.ts"]),
    );
  });

  it("runs Astro-aware lint and type checking in the hosted verify job", () => {
    const packageJson = readJson("package.json");
    const scripts = packageJson.scripts as Record<string, string>;
    const workflow = fs.readFileSync(path.join(ROOT, ".github/workflows/ci.yml"), "utf8");

    expect(scripts.lint).toContain("eslint");
    expect(scripts.typecheck).toBe("astro check");
    expect(scripts.check).toBe("pnpm lint && pnpm typecheck");
    expect(workflow).toContain("run: pnpm check");
  });
});
