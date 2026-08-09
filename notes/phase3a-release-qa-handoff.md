# Phase 3A release-candidate / QA / deploy seam — handoff

Task #13 (momoko 2026-08-09). Final candidate after two NO-GO rounds; contract
confirmed by momoko (msg f9fd5c02). Baseline: current GitHub main
`481bfc6308a819eec3e8584d982db9ebff83697b`.

## Deliverables

- **ci.yml**: Node 24; checkout/setup-node/upload-artifact pinned v5 full-SHA;
  `pnpm/action-setup` removed → corepack (no Node20 annotation).
  `upload-artifact` gated `if: failure() && hashFiles('test-results/**') != ''`;
  Playwright `outputDir` + `trace: retain-on-failure`.
- **preview.yml** (two-job DAG, secret-gated, public-only artifact):
  - `build` (zero secret): validate `target_sha` 40-hex; checkout fixed ref;
    record `dispatch_main_sha` + `target_equals_dispatch_main` +
    `target_is_ancestor_of_dispatch_main`; `pnpm build:public` into clean
    `dist-public` (reviewed/current only); run `public-audit.mjs`; upload one
    public artifact; compute content hash; summary writes
    `deploy_status=artifact_only_public` (deploy=false) or `requested`
    (deploy=true).
  - `deploy` (`needs: build`, `environment: preview`, `if: inputs.deploy`):
    download public artifact (no checkout / no target-code run); require
    CLOUDFLARE_API_TOKEN/ACCOUNT_ID/PROJECT_NAME (no defaults); read-only
    project preflight (refuses to create); full-SHA
    `cloudflare/wrangler-action@9acf94a...`; final `if: always()` summary writes
    requested→succeeded/failed + preview URL.
- **public build mode** (`PUBLIC_BUILD=1` → `pnpm build:public`): `loadNews()`
  filters to reviewed/current; draft/stale/retracted detail routes and bodies
  are NOT produced (not replaced by noindex). Default local build keeps the
  approved draft/stale noindex preview behavior.
- **public/_headers**: CSP + security headers (present in the public artifact
  for the future Cloudflare deploy surface; no deploy performed now).
- **tests/workflow-config.test.ts**: full-SHA pinning, Node24/no-secret/no-
  pnpm-action in ci, conditional evidence upload, two-job DAG (build zero-secret
  → deploy needs+environment+if), deploy gated/read-only/required-vars/
  wrangler-pinned/final summary.
- **tests/artifact-audit.test.ts**: runs `build:public`, asserts public
  manifest/search/HTML exclude draft/stale/retracted + raw/secret-shaped
  values (via `tools/schema/public-audit.mjs`), security headers present, and
  default build keeps draft preview while public build drops it.

## Verification (cold, dedicated worktree)

`pnpm check` 0/0/0; `pnpm test` 102 passed; `pnpm build:verify` 22 files
byte-identical; public build deterministic (double build diff empty);
`pnpm test:e2e` 14/14. Action SHAs verified to resolve to real commits
(checkout v5, setup-node v5, upload-artifact v5, download-artifact v5,
cloudflare/wrangler-action v3). No production deploy; no workflow actually
dispatched.
