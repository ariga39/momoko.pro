import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

import { REPO_ROOT } from "../tools/schema/css-tokens.ts";

/**
 * Static reconciliation of the canonical visual-baseline environment
 * (docs/visual-baseline-env.md). Hosted CI and the local regeneration
 * scripts must agree on: runner image, Node version, pnpm version,
 * Playwright version, and the pinned container digest — so the local entry
 * can never silently diverge from what CI renders with.
 */

const ENV_DOC = path.join(REPO_ROOT, "docs", "visual-baseline-env.md");
const REGEN_SCRIPT = path.join(REPO_ROOT, "scripts", "regenerate-visual-baselines.sh");
const SUITE_SCRIPT = path.join(REPO_ROOT, "scripts", "run-browser-suite.sh");
const CI_WF = path.join(REPO_ROOT, ".github", "workflows", "ci.yml");
const PACKAGE_JSON = path.join(REPO_ROOT, "package.json");
const LOCKFILE = path.join(REPO_ROOT, "pnpm-lock.yaml");

const PINNED_DIGEST = "sha256:b839c14c4410998529ec18f951262bdf87a2b23bc1467304d07b491b9455e074";
const PINNED_RUNNER = "ubuntu-24.04";
const PINNED_NODE = "24";
const PINNED_PNPM = "9.15.9";
const PINNED_PLAYWRIGHT = "1.62.1";

describe("visual baseline environment contract", () => {
  it("hosted runner is pinned to ubuntu-24.04 with Node 24", () => {
    const workflow = yaml.load(fs.readFileSync(CI_WF, "utf-8")) as {
      jobs?: Record<string, { "runs-on"?: string; steps?: Array<{ uses?: string; with?: Record<string, string> }> }>;
    };
    const job = workflow.jobs?.verify;
    expect(job?.["runs-on"], "runs-on must be pinned").toBe(PINNED_RUNNER);
    const setupNode = job?.steps?.find((step) => step.uses?.startsWith("actions/setup-node@"));
    expect(String(setupNode?.with?.["node-version"]), "node-version must match the canonical env").toBe(PINNED_NODE);
  });

  it("packageManager pins pnpm 9.15.9", () => {
    const pkg = JSON.parse(fs.readFileSync(PACKAGE_JSON, "utf-8")) as { packageManager?: string };
    expect(pkg.packageManager).toContain(`pnpm@${PINNED_PNPM}`);
  });

  it("lockfile pins Playwright 1.62.1", () => {
    const lock = fs.readFileSync(LOCKFILE, "utf-8");
    expect(lock).toContain(`playwright-core@${PINNED_PLAYWRIGHT}:`);
    expect(lock).toContain(`'@playwright/test@${PINNED_PLAYWRIGHT}':`);
  });

  it("both scripts and the env doc pin the same container digest", () => {
    const sources = [
      fs.readFileSync(REGEN_SCRIPT, "utf-8"),
      fs.readFileSync(SUITE_SCRIPT, "utf-8"),
      fs.readFileSync(ENV_DOC, "utf-8"),
    ];
    for (const source of sources) {
      expect(source, "digest must be pinned verbatim").toContain(PINNED_DIGEST);
    }
  });

  it("env doc names the same runner and versions as the workflow", () => {
    const doc = fs.readFileSync(ENV_DOC, "utf-8");
    expect(doc).toContain(PINNED_RUNNER);
    expect(doc).toContain("Node");
    expect(doc).toContain(PINNED_PNPM);
    expect(doc).toContain(PINNED_PLAYWRIGHT);
  });

  it("no script falls back to a mutable container tag", () => {
    const regen = fs.readFileSync(REGEN_SCRIPT, "utf-8");
    const suite = fs.readFileSync(SUITE_SCRIPT, "utf-8");
    // image references must be digest-pinned, never bare mutable tags
    for (const source of [regen, suite]) {
      for (const line of source.split("\n")) {
        const trimmed = line.trim();
        if (trimmed.startsWith("DIGEST=")) continue;
        expect(trimmed.includes("catthehacker/ubuntu:act-24.04"), `mutable tag reference: ${trimmed}`).toBe(false);
      }
    }
  });
});
