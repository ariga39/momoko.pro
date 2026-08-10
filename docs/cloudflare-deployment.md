# Cloudflare Deployment Readiness (task #26)

This documents the **readiness** for deploying momoko.pro to Cloudflare Workers.
It deliberately does **not** deploy or upload: no account, worker, version,
custom domain, or route is created or activated. The repository remains private
and the site is not published until the human explicitly authorizes it.

## Runtime target

- Astro `output: "server"` + `@astrojs/cloudflare` (added by task #20) builds a
  Worker entry at `dist/_worker.js/index.js`.
- `wrangler.jsonc` pins the Worker config explicitly: `main`, `assets.directory`
  + `ASSETS` binding, `compatibility_date`, `compatibility_flags`, and
  `preview`/`production` environments. It stores **no** `account_id`, custom
  route/domain, real namespace id, or production secret, and configures no
  unused D1/KV/R2 binding. `observability` is off until a designed log/privacy
  surface exists.
- `wrangler dev` verifies server routes and the locale cookie locally.
- `wrangler versions upload --env preview --dry-run --outdir <tmp>` produces a
  local bundle and audits the artifact **without any external write or version
  upload**.

## Safety model

| Concern | Behavior |
| --- | --- |
| Missing `wrangler.jsonc` | `deploy-dryrun` fails closed (`missing_wrangler_config`). |
| Build failure | `deploy-dryrun` fails closed (`dry_run_failed`). |
| Missing `_worker.js` entry | fails closed (`missing_worker_entry`). |
| Missing asset manifest | fails closed (`missing_asset_manifest`). |
| Source maps present | fails closed (`source_map_present`). |
| Artifact over Free-plan size limit | fails closed (`worker_size_over_limit`). |
| Repeated dry-run differs | fails closed (`non_deterministic_bundle`). |
| Deploy credentials present in dry-run | the preview-upload workflow refuses to run. |
| Missing/invalid confirmation input | workflow fails closed before any step. |

`scripts/deploy-dryrun.mjs` is the no-secret offline audit seam used by CI. It
runs `wrangler deploy --dry-run --outdir <tmp>` (or the equivalent
`versions upload --dry-run`), which only compiles and checks — it never creates
a preview version or any external object. The audit checks entry/asset
manifest presence, bundle size against the Cloudflare Workers Free plan limit
(2026-08-10), absence of source maps/secrets/demo/preview content and external
deploy dependencies, and byte-identical output across repeated dry-runs.

## Two distinct paths (kept separate)

1. **Offline / CI audit (no secret)**: `wrangler deploy --dry-run --outdir` (or
   `versions upload --dry-run`). Reproducible bundle/manifest/size/content
   audit; zero external write. This is what the current `scripts/deploy-dryrun.mjs`
   and CI execute.
2. **Future authorized preview upload**: `wrangler versions upload --env
   preview` (without `--dry-run`), which creates a non-active preview version /
   preview URL but does not deploy. Committed as `.github/workflows/deploy-preview.yml`
   with an explicit `upload-preview-version` confirmation, GitHub
   `environment: preview`, and fail-closed token/account handling. This task
   only commits and tests the workflow; it **never triggers** the upload.

## Permission model

- **preview**: manual `workflow_dispatch` requiring the explicit
  `upload-preview-version` confirmation and the `preview` environment. It runs
  the offline dry-run audit first, then fails closed if `CLOUDFLARE_API_TOKEN`
  or `CLOUDFLARE_ACCOUNT_ID` is missing. The actual `versions upload` step is
  intentionally not executable by this task.
- **production**: intentionally **not created** yet. Requires explicit human
  authorization for actual Worker creation, version upload, custom domain/route
  writes, and deployment.

## Rollback and domain-switch checklist (not executed)

1. Freeze content to the reviewed/current package (`MOMOKO_CONTENT_PACKAGE_*`).
2. Build deterministically and audit the dry-run bundle.
3. Switch the Worker version/route to the new version only after CI + peer are
   green; use Worker `version`/`deployment` semantics (active vs inactive).
4. On rollback, activate the previous immutable version; keep the previous
   bundle/hash as the recovery object.
5. Record secret/binding presence; never print DSNs, tokens, account IDs, or
   absolute paths.

## Status

No tag/release, package, image, worker, version, domain, or route is created or
uploaded by this slice. The current branch is an **intermediate** development/
validation object on the static baseline; the final delivery object must be a
rebase onto the task #20 server main proving `dist/_worker.js/index.js`,
locale/cookie routing, and the assets binding. Offline readiness and the
not-executed preview upload are reported separately. Repository visibility
stays private.
