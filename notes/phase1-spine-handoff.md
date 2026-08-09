# Phase 1 implementation spine — handoff

Task #4 (momoko 2026-08-09, thread #momoko-site:9537ed28). Baseline:
GitHub main `828e5c1ac8fbe676c96f0b73a242d6c16d4526dd` (design merge; working
tree = design head `c82dc94...`).

## Scope delivered

- **Repo skeleton**: Astro 5 + TypeScript + pnpm 9 frozen lockfile (`pnpm-lock.yaml`
  committed, Node ≥ 20, engine pinned). Third-party Actions pinned to full SHA;
  PR path has no secrets and does not deploy.
- **Executable schema contract**: `schemas/**` + `config/sources.json` validated
  through `tests/schema.test.ts` (Ajv 2020-12 + formats). Source probes prove the
  cron seam: `automated_fetch=true` requires non-manual frequency, `false` must be
  manual; current S1–S5 stay `false/manual`. Content fixtures validated against
  `content.schema.json`/`locale.schema.json` (reviewed ⇒ reviewer/time required).
- **Routes**: `/` language selector (x-default + zh/ja/en hreflang), `/zh`, `/ja`,
  `/en` locale lists, and `/…/news/<slug>/` detail with missing-translation
  fallback to source language. Synthetic fixtures only (no official media/lyrics).
- **Deterministic build**: `manifest.json` + `search.json` generated at build into
  `dist/` (not committed). `pnpm build:verify` double-builds and byte-compares
  (13 files identical). `generated_at` derived from content (no build clock).
- **Search**: deterministic local JSON index (`/search.json`, client-side filter)
  — the locked ADR-05 fallback; testable via `/search` + e2e. Pagefind smoke not
  wired (kept as optional upgrade per §7.3).
- **CI**: `.github/workflows/ci.yml` (pull_request + main push): install
  (frozen lockfile) → typecheck → unit/schema tests → deterministic double-build →
  post-build artifacts → Playwright browser smoke → artifact upload. No CF/model
  secrets anywhere on the PR path.
- **Ownership**: `.github/CODEOWNERS` maps A–E mutually-exclusive boundaries.

## Commands

- `pnpm install` (frozen: `pnpm install --frozen-lockfile`)
- `pnpm test` — schema + unit (Ajv + content loader + manifest/search determinism)
- `pnpm typecheck`
- `pnpm build && pnpm build:post` — build + write manifest/search.json to dist
- `pnpm build:verify` — deterministic double-build byte compare
- `pnpm test:e2e` — Playwright smoke (needs `pnpm build` first)
- `node tools/schema/validate_schemas.py` — legacy Python validator (design-phase gate)

## Non-goals (deferred per contract)

Real cron adapter, manual-import write, AI provider, full wiki/news pages,
Cloudflare production deploy, D1/Workers/KV. Pagefind smoke can be added on a
later slice when its CJK acceptance fixture is stable.

## Note for reviewers

- `reviewed` canonical rows in fixtures use a synthetic reviewer handle
  (`reviewer-demo`); no real identity is implied.
- Dist/search/manifest are gitignored; determinism is proven by the CI gate, not
  by committing artifacts.
