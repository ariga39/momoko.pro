import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import yaml from "js-yaml";

import { REPO_ROOT } from "../tools/schema/css-tokens.ts";

const WF = path.join(REPO_ROOT, ".github", "workflows");
const FULL_SHA = /^[0-9a-f]{40}$/;

// Workflow YAML is dynamic; use a small structural type instead of `any`.
type Json =
  | null
  | boolean
  | number
  | string
  | Json[]
  | { [k: string]: Json };

type Step = { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, Json> };
type Job = { steps?: Step[] };
type Workflow = { on?: { workflow_dispatch?: { inputs?: Record<string, { required?: boolean }> } }; jobs?: Record<string, Job> };

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

describe("CI/preview workflow — release-candidate quality", () => {
  it("all third-party Actions pinned to full 40-char SHA (supply-chain fixed)", () => {
    for (const f of ["ci.yml", "preview.yml"]) {
      const uses = collectUses(loadWorkflow(f));
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) {
        const [, sha] = u.split("@");
        expect(sha, `${f}: ${u}`).toMatch(FULL_SHA);
      }
    }
  });

  it("ci.yml uses Node 24 and does NOT deploy or inject secrets", () => {
    const doc = loadWorkflow("ci.yml");
    const steps = (doc.jobs?.verify?.steps ?? []) as Step[];
    const setupNode = steps.find((s) => s.name === "Setup Node");
    expect(setupNode?.with?.["node-version"]).toBe(24);
    const blob = JSON.stringify(steps);
    expect(blob).not.toMatch(/CF_TOKEN|CLOUDFLARE_API_TOKEN|secrets\./i);
    expect(blob).not.toMatch(/wrangler|pages deploy/i);
  });

  it("ci.yml upload-artifact is conditional on failure (no empty-dir warning)", () => {
    const doc = loadWorkflow("ci.yml");
    const steps = (doc.jobs?.verify?.steps ?? []) as Step[];
    const artifactStep = steps.find((s) =>
      s.name?.toLowerCase().includes("upload browser artifacts"),
    );
    expect(artifactStep).toBeTruthy();
    expect(artifactStep?.if).toBe("failure()");
  });

  it("preview.yml is manual workflow_dispatch on fixed ref only, never fake-deploys", () => {
    const doc = loadWorkflow("preview.yml");
    const wd = doc.on?.workflow_dispatch;
    expect(wd).toBeTruthy();
    expect(wd?.inputs?.ref?.required).toBe(true);
    const steps = (doc.jobs?.["build-and-preview"]?.steps ?? []) as Step[];
    const checkout = steps.find((s) => s.name === "Checkout fixed ref");
    expect(checkout?.with?.ref).toBe("${{ inputs.ref }}");
    const gate = steps.find((s) => s.name?.includes("Deployment gate"));
    expect(gate?.run).toMatch(/skipped=true/);
    expect(gate?.run).toMatch(/exit 1/);
  });
});
