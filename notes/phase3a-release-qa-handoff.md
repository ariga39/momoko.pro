# Phase 3A release-candidate / QA — handoff

Task #13 (momoko 2026-08-09). Final candidate after multiple NO-GO rounds.
Baseline: current GitHub main
`481bfc6308a819eec3e8584d982db9ebff83697b`.

Scope decision (momoko): no remote preview/deploy surface is required for the
MVP — there is no external reviewer and no configured Cloudflare preview
project. `preview.yml` and its dedicated tests/docs were removed. The PR keeps
release-quality CI, the deterministic public-only content build + audit, and
the Playwright E2E smoke. Human review uses the local build.

## Deliverables

- **ci.yml**: Node 24; checkout/setup-node/upload-artifact pinned v5 full-SHA;
  `pnpm/action-setup` removed → corepack (no Node20 annotation);
  `package-manager-cache: false` on setup-node (v5 default would look for pnpm
  before corepack activates it).
  `upload-artifact` gated `if: failure() && hashFiles('test-results/**') != ''`;
  Playwright `outputDir` + `trace: retain-on-failure`. No secrets; no deploy;
  no `${{ ... }}` expressions inside `run:` blocks.
- **public build mode** (`PUBLIC_BUILD=1` → `pnpm build:public`): `loadNews()`
  filters to reviewed/current; draft/stale/retracted detail routes and bodies
  are NOT produced (not replaced by noindex). Default local build keeps the
  approved draft/stale noindex preview behavior.
- **public/_headers**: CSP + security headers (retained for the eventual
  production surface; no deploy performed now).
- **tests/workflow-config.test.ts**: full-SHA pinning, Node24/no-secret/no-
  pnpm-action, setup-node no-cache + package-manager-cache off, no `${{ ... }}`
  in `run:` blocks, conditional evidence upload.
- **tests/artifact-audit.test.ts**: runs `build:public`, asserts public
  manifest/search/HTML exclude draft/stale/retracted + raw/secret-shaped
  values (via `tools/schema/public-audit.mjs`), security headers present, and
  default build keeps draft preview while public build drops it. Self-contained
  (builds default `dist/` on demand in cold-start worktrees).

## Verification (cold, dedicated worktree)

`pnpm check` 0/0/0; `pnpm test` 106 passed; `pnpm build:verify` 22 files
byte-identical; public build deterministic (double build diff empty);
`pnpm test:e2e` 14/14. No production deploy; no workflow actually dispatched.
