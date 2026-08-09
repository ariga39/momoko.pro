# Phase 3A source decision: no-fetch gate

Status: blocked at the real-source boundary. This candidate records the
source-policy decision and the synthetic fail-closed proof; it does not fetch
an official page or create a real draft.

## Exact base and ownership

- GitHub main: `9e99b9428f9103f21d76731a1b85acdd3bbbdd54`
- Candidate branch: `phase3a/source-decision-shizuka`
- Scope: `notes/phase3a-source-decision.md` and
  `tests/phase3a-source-decision.test.ts` only.
- No changes to `config/sources.json`, source adapters, frontend files,
  deployment workflows, or external services.

## Source decision

The single evaluated candidate is S1, the official ミリシタ site:

`https://millionlive-theaterdays.idolmaster-official.jp/`

The repository's source evidence was retrieved on 2026-08-08 and is the
authoritative policy input for this run:

- `robots.txt` returned HTTP 404.
- No public terms page was found for the domain; the game terms are inside
  the application.
- `config/sources.json` records `robots_result=unavailable`,
  `robots_path_decision=allow` for `/`, and `automated_fetch=false`. The old
  `robots_approved` field remains false only as deprecated compatibility data.
- The source is therefore not enabled for automated crawling; the policy only
  permits human discovery/manual entry for it. Missing robots or terms
  evidence is not permission for reuse or unattended crawling.

The task-level read-only instruction does not override that gate. No agent
HTTP request, substitute-source search, terms acceptance, allowlist change,
or cron run is authorized by this candidate. The same no-fetch decision
applies to S2–S5 because the canonical configuration keeps
`automated_fetch=false` for every source; the deprecated approval fields are
not an additional decision gate.

## Follow-up policy clarification (task #18)

The configuration now separates the RFC result from the decision for a target
path:

- `robots_result` is one of `rules_available`, `unavailable`, `unreachable`,
  or `not_applicable`.
- `robots_path_decision` is one of `allow`, `disallow`, `no_match`, or
  `not_evaluated`, and is bound to `checked_path`, `retrieved_at`, and
  `evidence`. A root-path allow is not a whole-site allow.
- S1's HTTP 404 is `robots_result=unavailable` with
  `robots_path_decision=allow` for `/`. RFC 9309 permits a crawler to proceed
  past a 4xx unavailable file; this is not terms, copyright, or project
  authorization. A 5xx/network failure is `unreachable` and fails closed.
- `robots_http` and the old `robots_approved` field are compatibility evidence
  only. The old field is deprecated and is not read by the new decision seam;
  missing new state remains fail-closed for crawler access rather than being
  inferred from the HTTP number.

The pure decision seam requires an explicit access mode:
`human_directed_single_page`, `scheduled_or_recursive_crawler`, or
`reuse_or_republication`. A public single-page human-directed read is not
blocked by `automated_fetch=false` or missing robots, but access controls and
explicit prohibitions still deny it. A crawler requires `automated_fetch=true`
and a path-bound robots decision. Reuse/republication requires independent
permission and a citation boundary. These modes are never interchangeable.

## Boundaries

There is no source retrieval date for this run because no source bytes were
requested. The only recorded date above is the date of the repository policy
evidence. If a future owner authorizes a source, the minimum local record is
the URL, retrieval timestamp, HTTP/status category, response hash, and the
smallest factual fields needed for review. No response body, image, logo,
audio, lyrics, full-text excerpt, or prompt-injection payload may enter Git,
Raft, logs, or committed fixtures.

The future adapter must use one HTTPS request at a time with a declared user
agent, bounded rate and cache, and no retries outside the declared budget.
Stop immediately on an owner/source takedown request, robots or terms change,
403/429/5xx, URL or schema ambiguity, or untrusted instructions in the
response. X remains excluded unless a separately approved official API or
embed contract exists.

## Existing public seam

The intended path is:

`DiscoveryItem` → `normalizeDiscovery` → `contentHash`/`planImport` →
versioned atomic `writeDraft` → `createDraftFromDiscovery` → human-bound
`issueReviewToken`/`reviewDraft`.

Under the current policy, `runCron()` must return the silent no-op summary
`fetched=[]`, `produced=0`, `duplicates=0`, `errors={}` before any adapter or
HTTP call. A synthetic normalized item may be converted to an in-memory
editorial draft, but it remains `draft` and is not indexable. No persistence
or publication projection is materialized by this candidate.

## Failure matrix

| Boundary | Expected result | External/public write |
| --- | --- | --- |
| Project `automated_fetch=false` | `automated_fetch_disabled` / silent no-op for crawler | None |
| Robots HTTP 404/other 4xx + path allow | `unavailable + allow`; crawler may proceed when project gate is enabled | None |
| Explicit path disallow or 5xx/network failure | Fail closed | None |
| Human single page with missing robots | Allowed only when public and not explicitly prohibited | None |
| Reuse without independent permission/citation boundary | Structured rejection | None |
| HTTP 403/429/5xx or source request | Structured stop, no retry | None |
| Terms/robots change or path leaves canonical scope | Fail closed | None |
| Invalid schema, date, URL, or untrusted prompt text | Reject as data, no execution | None |
| Same identity and content hash | Duplicate/no-change | None |
| Changed content hash | Versioned successor only after authorization | No publication |
| Editorial token/identity/hash drift | Reject review | No publication |
| Build/deploy/Cloudflare path | Out of scope for this run | None |

## Smallest allowlisting checklist

Before any future source is enabled, an accountable owner must provide all
of the following:

1. Current official robots evidence and official terms/guideline evidence,
   with URL, retrieval time, exact permitted host/path scope, and a clear
   statement that the proposed access is covered.
2. If public terms are absent, an explicit owner waiver naming the source and
   paths, permitted access method, cache/quote boundary, and an expiry or
   revocation condition. The waiver must not be inferred from silence.
3. A declared user agent, request frequency/concurrency/retry budget, cache
   lifetime, stored-field allowlist, and stop conditions.
4. A reviewed config change setting `automated_fetch=true` only after every
   crawler target path has explicit robots result/decision evidence; source
   policy tests and the negative-path test must remain green. The deprecated
   `robots_approved` field is not used as a second gate.
5. A synthetic adapter/normalization/dedup/editorial regression plus a local
   aggregate run that proves no public asset, full text, secret, or external
   write is produced.

## Synthetic proof

`tests/phase3a-source-decision.test.ts` registers adapters whose fetch methods
would call a mocked HTTP function, then runs against the real checked-in
configuration. The test proves all five configured sources are blocked before
adapter/HTTP invocation, the ingest draft root is unchanged, and public
content roots are byte-identical. A separate synthetic record exercises the
normalization/editorial seam in memory and asserts `draft`/non-indexable
projection with the same zero-write snapshot. No real response or source
identifier beyond the policy's S1 label is used as a fixture.
