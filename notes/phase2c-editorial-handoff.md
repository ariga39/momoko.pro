# momoko.pro Phase 2C editorial lifecycle handoff

Author: 静香（shizuka）
Peer: tsumugi（content/i18n contract）
Final acceptance/merge: 桃子（momoko）
Branch: `phase2c/editorial-lifecycle-shizuka`
Base: GitHub main `48a1a3aee437db16659fb7807e89fcd332243da6`

## Scope and ownership

This candidate owns the editorial seam in `tools/editorial/editorial.ts`, the
synthetic lifecycle fixture under
`content/news/2026/S1-synth-2026-08-08-002/`, editorial unit/public-seam
regressions, and the small read-only frontend/build integration that prevents
draft/stale/retracted records entering archive/search indexes. It does not
modify `tools/ingest/**`, source adapters, workflows, deployment, authentication,
or any external/private material.

The input is a normalized `DiscoveryItem` from the Phase 2B seam. The output is
the existing `content.schema.json` canonical Japanese `index.md`, two
`locale.schema.json` translation status records (`content.zh.md` and
`content.en.md`), and an `editorial-history.json` append-only audit sidecar.

## State and migration model

There is no database or schema migration. Canonical and locale files remain
schema version `1`; the new editor-side history is version `1` and records
canonical/locale scope, sequence, operation id, actor, actor kind, UTC time,
reason, source hash, content hash, and optional model version. The history
reader rejects identity/sequence/operation/status drift before any write.

Canonical statuses remain `draft | reviewed | stale | retracted`. `published`
is never accepted as a mutable action or written to canonical files: the build
projection derives it only from reviewed/current content. A source revision
creates a new canonical draft and marks prior locale records stale; an active
retraction keeps canonical/locale tombstones and writes the existing
`content/retractions/*.json` record. No file is deleted to retract content.

## Public seam

- `createDraftFromDiscovery()` consumes normalized discovery and creates a
  canonical Japanese draft plus zh/en draft records.
- `addTranslationDraft()` accepts AI or human translation output only as
  `draft`; model/actor provenance is retained in history.
- `issueReviewToken()` binds a human review token to identity, source hash,
  target hash, scope, locale, confirmer, and issue time. Non-human actors cannot
  mint or confirm review tokens.
- `reviewDraft()` performs the explicit human gate with structured drift,
  conflict, illegal-actor, and idempotency results.
- `updateSourceRevision()` stales old locale records on source hash change;
  old review tokens fail closed.
- `retractEditorial()` creates canonical/locale tombstones and a retraction
  record in one audited logical operation.
- `derivePublication()` is read-only and returns the build-only published/
  indexable projection.
- `materializeDiscovery()`, `persistEditorialBundle()`, and
  `readEditorialBundle()` provide an offline file seam. Bundle persistence uses
  a staged directory swap with rollback; invalid state/history is rejected
  before writes.

The frontend keeps detail routes available for explicit draft/stale fallback
pages (with noindex/canonical semantics), while `loadPublishedNews()` is the
only source for archive, source-policy listing, search, and post-build search
index. Retracted content is excluded from all public index surfaces.

## Synthetic verification

`tests/editorial.test.ts` covers normalized discovery output, AI/T2 review
blocking, human token binding, translation draft/review, source drift and
stale fallback, history retention across persisted revisions, retraction
tombstones, idempotent replay/no-change, identity collision, and public
reviewed/current projection. Existing schema/translation tests and Playwright
smoke tests also assert draft exclusion and fallback behavior.

All content in this candidate is synthetic test material. No external fetch,
AI service, GitHub write, deployment, login, or private material is used.
