# Task #18: robots result and agent access policy handoff

## Scope

This docs/config/schema successor records RFC 9309 result semantics and a
pure, explicit access-mode decision seam. It does not fetch a source, change
the allowlist, enable `automated_fetch`, add a crawler, or touch visual task
#17 files.

## Contract

- `robots_result` is one of `rules_available`, `unavailable`, `unreachable`,
  or `not_applicable`.
- `robots_path_decision` is one of `allow`, `disallow`, `no_match`, or
  `not_evaluated`; it is bound to `checked_path`, `retrieved_at`, and
  `evidence`. A path decision is never a whole-site permission.
- HTTP 400–499, including 404, is `unavailable`; a 5xx or network failure is
  `unreachable`. A 404 plus an explicit path `allow` is crawler-readable under
  RFC 9309, while an unreachable result or path `disallow` fails closed.
- `robots_http` and the old `robots_approved` field are compatibility data.
  `robots_approved` is deprecated, read only for old-config compatibility, and
  never participates in the new decision. Missing new result/path evidence
  fails closed for crawler access; no status is inferred from the HTTP number.
- `decideSourceAccess()` requires an explicit `access_mode`:
  `human_directed_single_page`, `scheduled_or_recursive_crawler`, or
  `reuse_or_republication`.
  - Human single-page access is not blocked by `automated_fetch=false` or
    missing robots, but public access and non-prohibited terms are required.
  - Crawler access requires `automated_fetch=true` and a path-bound allowed
    robots decision.
  - Reuse/republication requires independent reuse permission and a citation
    boundary; robots allow alone is insufficient.

## Compatibility and migration

- Canonical `config/sources.json` records the new fields for S1–S5. S1/S4 are
  `unavailable + allow` for `/`; S2/S3 are `not_applicable`; S5 is
  `rules_available + allow` for `/`.
- The schema keeps new fields optional so a v1 config lacking them remains
  readable. The runtime crawler gate rejects such a config until a reviewed
  migration explicitly adds result, path, retrieval, and evidence state.
- Existing `robots_approved` values remain readable and are annotated as
  deprecated. They are not copied into or used as a new path decision. No
  database migration is involved.

## Verification

- Pure seam tests cover: 404/unavailable + crawler allow; 5xx/unreachable
  denial; independent valid-rule allow/disallow paths; missing or mismatched
  path evidence; human single-page access with no robots and automation off;
  access-control/explicit-terms denial; and reuse without an independent
  permission/citation boundary.
- Ingest tests prove cron uses `automated_fetch` plus the new path decision and
  ignores deprecated `robots_approved`.
- Phase 3A synthetic proof still makes zero HTTP calls and zero writes under
  the checked-in all-manual policy.
- Source schema validation covers both result/path vocabularies and old-shape
  readability; the source-policy page exposes the distinction in zh/ja/en.

## Privacy and side effects

No real source, response body, private document, credential, or external
service was accessed. Only synthetic fixtures and checked-in policy metadata
were changed.
