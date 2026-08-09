# Phase 3B zero-state and content-package handoff

Task: #16
Owner: Mirai
Baseline: `cab7517238a4ee338d3b89767285bad671870707`
Candidate: the exact commit containing this handoff; the full SHA is recorded in the task-thread delivery message.

## Boundary

- The production package is `content/package.json`, with schema version `1`, content schema version `1`, and `status: empty`.
- Production and `PUBLIC_BUILD=1` read only the repository `content/` root and retain only `reviewed` items without an active retraction.
- `MOMOKO_CONTENT_PACKAGE_ROOT` requires an explicit `MOMOKO_CONTENT_PACKAGE_MODE=test|dev`; roots must be relative, real, recursively symlink-free, and inside the mode-specific repository allow-root. Unknown modes, missing roots, absolute paths, traversal, invalid manifests, and invalid content fail closed with stable redacted errors.
- Test/dev lifecycle previews are explicit only. The Playwright web server sets the test fixture root and `MOMOKO_CONTENT_PACKAGE_PREVIEW=1`; public builds reject package-root/mode overrides.
- The empty production package renders truthful zh/ja/en coming-soon, About, source/AI-use, correction/takedown, and empty-search states. No production synthetic content remains.

## Regression evidence

- `pnpm check`: 0 errors, 0 warnings, 0 hints.
- `pnpm test`: 115 passed.
- `pnpm test:e2e`: 14 passed.
- `pnpm build:verify`: 16 files byte-identical across two empty production builds.
- `python3 -m tools.schema.validate_schemas`: all positive and negative cases pass.
- `git diff --check`: clean.
- The artifact audit covers empty production/public output, synthetic/demo markers, media and media tags, external scripts, secret-shaped values, and crawler/cron/deploy/maintenance/research paths. The explicit fixture build contains only reviewed-current item 001 in the static public projection; draft item 002 and retracted item 003 are retained only for explicit lifecycle preview tests.
- Required fail-closed tests are present and green: `explicit_missing_content_package_fails_closed`, `invalid_manifest_fails_closed`, and `ready_package_without_content_fails_closed`.

## Synthetic fixture migration checksum ledger

The following files were moved from the production content root to `tests/fixtures/content-package/synthetic/`. Each fixture SHA-256 matches its former production file:

| Former production-relative path | SHA-256 |
| --- | --- |
| `news/2026/S1-synth-2026-08-08-001/content.en.md` | `910dbc95c26ef48a235b91474039953668cfaefd8be7a331b40653c8eac13e88` |
| `news/2026/S1-synth-2026-08-08-001/content.zh.md` | `87aa879ccc49fe6ead733604333a485a32246edff14ec4ba7a7d8a2cc9322939` |
| `news/2026/S1-synth-2026-08-08-001/index.md` | `dc0b301e995426b4fc7096ffbfaf3cdb43f6ac0b6d1b6f4ed0ce46da08dae356` |
| `news/2026/S1-synth-2026-08-08-002/content.en.md` | `c0e3ed87fc7c75eec9134a937fdcc310033a1648390acd65325ae7935107d818` |
| `news/2026/S1-synth-2026-08-08-002/content.zh.md` | `72f6c26bf8612c6d41f08cf3478a5c836099ae18b08600340d974b2aec5ce6ef` |
| `news/2026/S1-synth-2026-08-08-002/editorial-history.json` | `5f16de0725c54536a18e8c555e7cb07a12c8b6f401a68388ccec6d6b65ce365e` |
| `news/2026/S1-synth-2026-08-08-002/index.md` | `3bf41f5b23d363943b6ea4a3a2661abc0e2273ce34c1cc3f4ac0c0a31f32828a` |
| `news/2026/S1-synth-2026-08-08-003/content.en.md` | `45ce7d82ed97ba777f47c2bd86931e556786bf954b8a2d23bfdef60153dfcc14` |
| `news/2026/S1-synth-2026-08-08-003/content.zh.md` | `370f485d9518b10aec3757ae92f583e8dae1e0ad9f3daf03243860847ab94788` |
| `news/2026/S1-synth-2026-08-08-003/editorial-history.json` | `b5b721586932b91d5dcba49534e0f3b20877de1b8eace1c876fb68029a9381c7` |
| `news/2026/S1-synth-2026-08-08-003/index.md` | `750fb0cba1ec6c9e535f893ffc3552aea20194fd4e5d0d1cde2a18830ab14db7` |
| `retractions/synthetic-003-retraction.json` | `2540f62e45f35cc32f3035b6d18d0b27f1282983df1912b8f9e277044ee2be92` |

No source policy, adapter, workflow, Cloudflare, deployment, real content, or external network behavior was changed.

署名：未来
