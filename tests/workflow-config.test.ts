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

describe("CI/preview workflow — release-candidate quality", () => {
  it("all third-party Actions pinned to full 40-char SHA", () => {
    for (const f of ["ci.yml", "preview.yml"]) {
      const uses = collectUses(loadWorkflow(f));
      expect(uses.length).toBeGreaterThan(0);
      for (const u of uses) {
        const [, sha] = u.split("@");
        expect(sha, `${f}: ${u}`).toMatch(FULL_SHA);
      }
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
    for (const f of ["ci.yml", "preview.yml"]) {
      const doc = loadWorkflow(f);
      for (const job of Object.values(doc.jobs ?? {})) {
        const steps = (job.steps ?? []) as Step[];
        const setupNode = steps.find((s) => s.name?.includes("Setup Node"));
        if (!setupNode) continue;
        expect(setupNode?.with?.["node-version"]).toBe(24);
        expect(setupNode?.with?.["cache"], `${f}: no cache: pnpm before corepack`).toBeUndefined();
        expect(
          setupNode?.with?.["package-manager-cache"],
          `${f}: package-manager-cache explicitly false (v5 default looks for pnpm pre-corepack)`,
        ).toBe(false);
        const nodeIdx = steps.indexOf(setupNode!);
        const corepackIdx = steps.findIndex((s) => /corepack/.test(s.run ?? ""));
        expect(corepackIdx, `${f}: corepack step after setup-node`).toBeGreaterThan(nodeIdx);
      }
    }
  });

  it("no `${{ ... }}` interpolation inside run: blocks (expressions via env or non-shell fields only)", () => {
    for (const f of ["ci.yml", "preview.yml"]) {
      const doc = loadWorkflow(f);
      const jobs = doc.jobs ?? {};
      for (const [jobName, job] of Object.entries(jobs)) {
        for (const step of (job.steps ?? []) as Step[]) {
          if (!step.run) continue;
          expect(step.run, `${f} ${jobName} step "${step.name}"`).not.toMatch(
            /\$\{\{/,
          );
        }
      }
    }
    // inputs are mapped once through job env and referenced as quoted shell vars.
    const doc = loadWorkflow("preview.yml");
    for (const job of Object.values(doc.jobs ?? {})) {
      expect((job as Job & { env?: Record<string, string> }).env?.["TARGET_SHA"]).toBe(
        "${{ inputs.target_sha }}",
      );
    }
  });

  it("preview deploy: project name validated, wrangler command uses GitHub var (no literal shell var)", () => {
    const doc = loadWorkflow("preview.yml");
    const steps = (doc.jobs?.deploy?.steps ?? []) as Step[];
    const validate = steps.find((s) => s.name?.includes("Validate Cloudflare project name"));
    expect(validate?.run).toMatch(/CLOUDFLARE_PROJECT_NAME/);
    expect(validate?.run).toMatch(/leading dash/);
    expect(validate?.run).toMatch(/\[\[space\]\]|\[\[:space:\]\]/);
    const wrangler = steps.find((s) => s.name?.includes("Deploy preview"));
    expect(wrangler?.uses).toBe("cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0");
    const cmd = String(wrangler?.with?.["command"]);
    expect(cmd).toContain("${{ vars.CLOUDFLARE_PROJECT_NAME }}");
    expect(cmd).not.toMatch(/\$CLOUDFLARE_PROJECT_NAME/);
    const final = steps.find((s) => s.name?.includes("Final summary"));
    const finalEnv = final?.env as Record<string, string> | undefined;
    expect(finalEnv?.["DEPLOY_OUTCOME"]).toBe("${{ steps.deploy.outcome }}");
    expect(finalEnv?.["DEPLOY_URL"]).toBe("${{ steps.deploy.outputs.deployment-url }}");
    expect(final?.run).toMatch(/https:\/\//);
    expect(final?.run).toMatch(/malformed deployment URL/);
    expect(final?.run).not.toMatch(/\$\{\{/);
  });

  it("ci.yml upload-artifact conditional on failure AND evidence", () => {
    const doc = loadWorkflow("ci.yml");
    const steps = (doc.jobs?.verify?.steps ?? []) as Step[];
    const artifactStep = steps.find((s) => s.name?.toLowerCase().includes("upload browser artifacts"));
    expect(artifactStep?.if).toMatch(/failure\(\)/);
    expect(artifactStep?.if).toMatch(/hashFiles\('test-results\/\*\*'\) != ''/);
  });

  it("preview.yml is a two-job DAG: build (zero secret) → deploy (needs build, environment preview)", () => {
    const doc = loadWorkflow("preview.yml");
    const jobs = doc.jobs ?? {};
    const buildJob = jobs.build!;
    const deployJob = jobs.deploy!;
    expect(buildJob).toBeTruthy();
    expect(deployJob).toBeTruthy();
    expect(deployJob.needs).toBe("build");
    expect(deployJob.environment).toBe("preview");
    // deploy gated on inputs.deploy
    expect(deployJob.if).toMatch(/inputs\.deploy/);
    // build job: no secrets referenced
    const buildSteps = JSON.stringify(buildJob.steps ?? []);
    expect(buildSteps).not.toMatch(/secrets\.|CLOUDFLARE_API_TOKEN/);
    // deploy job: has environment secrets, does NOT checkout
    const deploySteps = JSON.stringify(deployJob.steps ?? []);
    expect(deploySteps).not.toMatch(/actions\/checkout/);
    expect(deploySteps).toMatch(/CLOUDFLARE_API_TOKEN/);
  });

  it("preview build: validates 40-hex, records ancestry, builds public-only, uploads one public artifact", () => {
    const doc = loadWorkflow("preview.yml");
    const steps = (doc.jobs?.build?.steps ?? []) as Step[];
    expect(steps.find((s) => s.name?.includes("Validate target_sha"))?.run).toMatch(/40-hex/);
    const preflight = steps.find((s) => s.name?.includes("Preflight"));
    expect(preflight?.run).toMatch(/cat-file/);
    expect(preflight?.run).toMatch(/target_is_ancestor_of_dispatch_main/);
    expect(preflight?.run).toMatch(/target_equals_dispatch_main/);
    const buildStep = steps.find((s) => s.name?.includes("Build public-only"));
    expect(buildStep?.run).toMatch(/dist-public/);
    const audit = steps.find((s) => s.name?.includes("Audit public artifact"));
    expect(audit?.run).toMatch(/public-audit\.mjs dist-public/);
    const summary = steps.find((s) => s.name?.includes("Publish preview summary"));
    expect(summary?.run).toMatch(/artifact_only_public/);
    expect(summary?.run).toMatch(/requested/);
  });

  it("preview deploy: env mapping (secrets/vars), curl read-only preflight, wrangler pinned, final summary", () => {
    const doc = loadWorkflow("preview.yml");
    const jobs = doc.jobs ?? {};
    const deployJob = jobs.deploy!;
    const steps = (deployJob.steps ?? []) as Step[];
    const download = steps.find((s) => s.name?.includes("Download public artifact"));
    expect(download?.uses).toMatch(/^actions\/download-artifact@[0-9a-f]{40}$/);
    // env mapping: secrets→token/account, vars→project (no defaults)
    const env = deployJob.env as Record<string, Json> | undefined;
    expect(env?.["CLOUDFLARE_API_TOKEN"]).toBe("${{ secrets.CLOUDFLARE_API_TOKEN }}");
    expect(env?.["CLOUDFLARE_ACCOUNT_ID"]).toBe("${{ secrets.CLOUDFLARE_ACCOUNT_ID }}");
    expect(env?.["CLOUDFLARE_PROJECT_NAME"]).toBe("${{ vars.CLOUDFLARE_PROJECT_NAME }}");
    const requireVars = steps.find((s) => s.name?.includes("Validate required environment variables"));
    expect(requireVars?.run).toMatch(/CLOUDFLARE_PROJECT_NAME:\?required/);
    // preflight: curl read-only exact GET, no bare wrangler, no `|| true`, no create command
    const preflight = steps.find((s) => s.name?.includes("preflight"));
    expect(preflight?.run).toMatch(/curl/);
    expect(preflight?.run).toMatch(/pages\/projects/);
    expect(preflight?.run).not.toMatch(/wrangler/);
    expect(preflight?.run).not.toMatch(/\|\| true/);
    expect(preflight?.run).not.toMatch(/pages project (create|delete)|--create|POST\s/);
    expect(preflight?.run).toMatch(/exit 1/);
    // deploy step uses full-SHA wrangler
    const wrangler = steps.find((s) => s.name?.includes("Deploy preview"));
    expect(wrangler?.uses).toBe("cloudflare/wrangler-action@ebbaa1584979971c8614a24965b4405ff95890e0");
    const final = steps.find((s) => s.name?.includes("Final summary"));
    expect(final?.if).toBe("always()");
  });
});
