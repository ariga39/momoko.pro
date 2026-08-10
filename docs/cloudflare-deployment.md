# Cloudflare Deployment Readiness (task #26)

This documents the **readiness** for deploying momoko.pro to Cloudflare Workers.
It deliberately does **not** perform a deployment: no account, worker, custom
domain, or route is created. The repository remains private and the site is not
published until the human explicitly authorizes it.

## Runtime target

- Astro `output: "server"` + `@astrojs/cloudflare` (added by task #20) builds a
  Worker entry at `dist/_worker.js/index.js`.
- `wrangler.jsonc` pins the Worker config explicitly so deploy-time config is
  never generated ad hoc: `main`, `assets.directory`, `compatibility_date`,
  `compatibility_flags`, and `preview`/`production` environments.
- `wrangler dev` verifies server routes and the locale cookie locally.
- `wrangler deploy --dry-run --outdir <tmp>` produces a local bundle and audits
  the artifact **without any external write**.

## Safety model

| Concern | Behavior |
| --- | --- |
| Missing `wrangler.jsonc` | `deploy-dryrun` fails closed (`missing_wrangler_config`). |
| Build failure | `deploy-dryrun` fails closed (`dry_run_failed`). |
| Missing `_worker.js` entry | fails closed (`missing_worker_entry`). |
| Artifact over size limit | fails closed (`worker_size_over_limit`). |
| Deploy token present in dry-run | `deploy-preview` workflow refuses to run (dry-run only). |
| Missing production secrets | a future production job must fail closed; never fake success. |

`scripts/deploy-dryrun.mjs` is the single dry-run/audit seam used by both CI and
the manual `deploy-preview` workflow.

## Permission model

- **preview**: manual `workflow_dispatch` on the `preview` GitHub environment;
  runs the dry-run audit only. No CF token, no account/worker/domain write.
- **production**: intentionally **not created** yet. Requires explicit human
  authorization for actual Worker creation, custom domain/route writes, and
  deployment.

## Rollback and domain-switch checklist (not executed)

1. Freeze content to the reviewed/current package (`MOMOKO_CONTENT_PACKAGE_*`).
2. Build deterministically and audit the dry-run bundle.
3. Switch the Worker route to the new version only after CI + peer are green.
4. On rollback, point the route back to the previous immutable version; keep the
   previous bundle/hash as the recovery object.
5. Record secret/binding presence; never print DSNs, tokens, or absolute paths.

## Status

No tag/release, package, image, worker, domain, or route is created by this
slice. Repository visibility stays private.
