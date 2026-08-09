# Phase 3A release-candidate / QA / deploy seam — handoff

Task #13 (momoko 2026-08-09). Successor after momoko NO-GO (msg 33a7eef1)
addressing all 5 deviations.

## Deliverables

- **ci.yml**: Actions upgraded to Node-24-compatible v5 full-SHA (checkout,
  setup-node, upload-artifact); `pnpm/action-setup` removed → `corepack enable`
  + `corepack prepare` (eliminates the Node20 deprecation annotation). Node 24.
  `upload-artifact` gated by `failure() && hashFiles('test-results/**') != ''`;
  Playwright `outputDir` + `trace: retain-on-failure` guarantee evidence files
  on failure.
- **preview.yml** (2-state, honest): `workflow_dispatch` inputs
  `target_sha` (required 40-hex) + `deploy` boolean (default false).
  Preflight validates 40-hex + `git cat-file` object exists + records
  default-main descendant relation. Artifact-only path (deploy=false) builds +
  uploads `dist/`, computes content hash, writes summary
  (`deploy_status=artifact_only`) and succeeds WITHOUT reading secrets.
  `deploy=true` → deploy gate fails (exit 1, `deploy_failed_no_secret`) when
  CF token/account missing, else full-SHA-pinned `cloudflare/wrangler-action`
  runs with `environment: preview`-style approval posture. No production
  deploy / CF project-domain writes / payment / new terms.
- **public/_headers**: minimal static security headers (CSP, nosniff,
  X-Frame-Options DENY, Referrer-Policy, Permissions-Policy) for the future
  Cloudflare Pages deploy surface (no deploy performed now).
- **tests/workflow-config.test.ts**: asserts full-SHA pinning, Node24 + no
  secrets/deploy in ci, no pnpm/action-setup, conditional evidence upload, and
  preview's 2-state honesty (target_sha 40-hex, deploy boolean, artifact-only
  summary, deploy-gate fail, full-SHA wrangler).
- **tests/artifact-audit.test.ts**: manifest/search contain only
  reviewed/current; no draft/retracted in build; security headers file;
  published hashes are sha256-shaped.
- **e2e**: added "archive lists only reviewed/current content".

## Verification (cold, dedicated worktree)

`pnpm check` 0/0/0; `pnpm test` 101 passed; `pnpm build:verify` 22 files
byte-identical; `pnpm test:e2e` 14/14. Action SHAs verified to resolve to real
commits (checkout v5, setup-node v5, upload-artifact v5,
cloudflare/wrangler-action v3).


## Scope delivered

- **ci.yml** (owned by E): upgraded `actions/checkout`, `actions/setup-node`,
  `actions/upload-artifact` v4→v5 with full-SHA pinning (supply-chain fixed;
  pnpm/action-setup v4 already latest). Node `24` (Node-20 deprecation
  resolved). `upload-artifact` now conditional `if: failure()` so empty
  `test-results/` no longer warns on success, while real failures still retain
  evidence. Still PR/main-only verify, no secrets, no deploy.
- **preview.yml** (new, E): manual `workflow_dispatch` on a required fixed
  `ref` input; default-branch workflow (never runs PR code with secrets);
  builds + uploads a `dist/` artifact; a deployment gate explicitly exits 1
  with `skipped=true` when the Cloudflare secret is absent — never fakes a
  successful deploy. No production deploy / Cloudflare project/domain writes /
  payment / new terms.
- **tests/workflow-config.test.ts**: asserts (1) all Actions pinned to full
  40-char SHA, (2) ci.yml uses Node 24 + no secrets/deploy, (3) upload-artifact
  is `failure()`-conditional, (4) preview is manual-on-fixed-ref and its gate
  marks skipped (never fake success).

## Ownership

Only `.github/workflows/**` + `tests/workflow-config.test.ts` touched. No
changes to `src/**`, `tools/ingest/**`, `tools/editorial/**`, or deploy targets.

## Verification (cold, dedicated worktree)

- `pnpm check` 0 errors/0 warnings/0 hints; `pnpm test` 95 passed (incl. 4 new
  workflow tests); `pnpm build:verify` 21 files byte-identical;
  `pnpm test:e2e` 13/13.
- Action SHAs verified to resolve to real commits in their repos (checkout v5,
  setup-node v5, upload-artifact v5, pnpm/action-setup v4).

## Notes for reviewers

- No production deployment workflow is created (deferred per contract).
- `preview.yml` requires a manual dispatch on a fixed SHA; it never auto-runs.
