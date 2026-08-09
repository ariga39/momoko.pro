import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

import { REPO_ROOT } from "../tools/schema/css-tokens.ts";

const WF = path.join(REPO_ROOT, ".github", "workflows");
const FULL_SHA = /^[0-9a-f]{40}$/;

type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, Json>; id?: string; env?: Record<string, Json> };
type Job = { steps?: Step[]; needs?: string | string[]; environment?: string; if?: string; env?: Record<string, Json> };
type Workflow = { on?: { workflow_dispatch?: { inputs?: Record<string, { required?: boolean; type?: string; default?: Json }> } }; jobs?: Record<string, Job> };

function loadWorkflow(name: string): Workflow {
  const raw = fs.readFileSync(path.join(WF, name), "utf-8");
  return yaml.load(raw) as Workflow;
}

function collectUses(doc: Workflow): string[] {
  const out: string[] = [];
  for (const job of Object.values(doc.jobs ?? {})) {
    for (const step of job.steps ?? []) {
      if (step.uses) out.push(step.uses);
    }
  }
  return out;
}

describe("CI workflow — release-candidate quality", () => {
  it("all third-party Actions pinned to full 40-char SHA", () => {
    const uses = collectUses(loadWorkflow("ci.yml"));
    expect(uses.length).toBeGreaterThan(0);
    for (const u of uses) {
      const [, sha] = u.split("@");
      expect(sha, `ci.yml: ${u}`).toMatch(FULL_SHA);
    }
  });

  it("ci.yml uses Node 24, no secrets/deploy, no pnpm/action-setup", () => {
    const doc = loadWorkflow("ci.yml");
    const steps = (doc.jobs?.verify?.steps ?? []) as Step[];
    const setupNode = steps.find((s) => s.name === "Setup Node");
    expect(setupNode?.with?.["node-version"]).toBe(24);
    const blob = JSON.stringify(steps);
    expect(blob).not.toMatch(/CF_TOKEN|CLOUDFLARE_API_TOKEN|secrets\./i);
    expect(blob).not.toMatch(/wrangler|pages deploy/i);
    expect(blob).not.toMatch(/pnpm\/action-setup/);
  });

  it("setup-node does not require pnpm before corepack activates it (no cache + explicit package-manager-cache off)", () => {
    const doc = loadWorkflow("ci.yml");
    const steps = (doc.jobs?.verify?.steps ?? []) as Step[];
    const setupNode = steps.find((s) => s.name?.includes("Setup Node"));
    expect(setupNode?.with?.["node-version"]).toBe(24);
    expect(setupNode?.with?.["cache"], "no cache: pnpm before corepack").toBeUndefined();
    expect(setupNode?.with?.["package-manager-cache"]).toBe(false);
    const nodeIdx = steps.indexOf(setupNode!);
    const corepackIdx = steps.findIndex((s) => /corepack/.test(s.run ?? ""));
    expect(corepackIdx).toBeGreaterThan(nodeIdx);
  });

  it("no `${{ ... }}` interpolation inside run: blocks (expressions via env or non-shell fields only)", () => {
    const doc = loadWorkflow("ci.yml");
    const jobs = doc.jobs ?? {};
    for (const [jobName, job] of Object.entries(jobs)) {
      for (const step of (job.steps ?? []) as Step[]) {
        if (!step.run) continue;
        expect(step.run, `ci.yml ${jobName} step "${step.name}"`).not.toMatch(
          /\$\{\{/,
        );
      }
    }
  });

  it("ci.yml upload-artifact conditional on failure AND evidence", () => {
    const doc = loadWorkflow("ci.yml");
    const steps = (doc.jobs?.verify?.steps ?? []) as Step[];
    const artifactStep = steps.find((s) => s.name?.toLowerCase().includes("upload browser artifacts"));
    expect(artifactStep?.if).toMatch(/failure\(\)/);
    expect(artifactStep?.if).toMatch(/hashFiles\('test-results\/\*\*'\) != ''/);
  });
});
