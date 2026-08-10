# Phase 4A visual experience handoff

Status: task #19 final successor after the exact-head visual/UX peer found two WCAG AA and handoff-truthfulness gaps, followed by an approved structure checkpoint. The successor keeps the accepted v0.5 direction and adds only the agreed structure correction (single canvas, exact desktop proportions, no home dynamic stream, responsive order), text-contrast tokens/usages, class-level regression coverage, and this handoff. The reviewed predecessor was `c733be97bf8dc451fb7ebd81c5cd02d436272757`; the successor commit containing this handoff is the current review object, with its full SHA recorded in the task-thread delivery message.

Implementation branch: `feat/task19-v05-mirai`. Successor parent: `d5dbac56089f0c27314dfc9044b9d02263c8c607`. The branch is the sole head of Draft PR #14, based on `main` (observed base `406af4c5ce71fbeaf536d5c7f64a96dc4f0b56cc`). No deployment or production write is authorized.

## Direction and measurable tokens

The v0.5 visual language is a narrow editorial folio: warm paper, ink-blue reading text, Momoko pink, restrained brass, ruled pages, a fine rule, and three chapter entrances. The original bright pink and brass remain available for large or decorative marks; semantic small text uses dedicated AA tokens.

| Token | Value | Contract |
| --- | --- | --- |
| `folio-paper` | `#f8f1df` | folio page surface |
| `folio-paper-deep` | `#eee3c8` | folio panel surface |
| `folio-ink` | `#283247` | reading text |
| `folio-navy` | `#243e61` | chapter card surface |
| `folio-pink` | `#ce5c7b` | large/decorative pink only |
| `folio-pink-ink` | `#7f1d3f` | semantic small text; AA on paper, blue, and pink-soft |
| `folio-pink-soft` | `#efc5cc` | pale pink surface |
| `folio-blue` | `#9fb9d4` | blue surface |
| `folio-brass` | `#bd9340` | large/decorative brass only |
| `folio-brass-ink` | `#6f4c14` | semantic small text; AA on pink-soft, paper-deep, and paper |
| `folio-brass-light` | `#d6ad58` | chapter index text/arrow; AA on navy |
| `folio-line` | `#cdb58b` | non-text rule/boundary |

The display stack is `Iowan Old Style, Baskerville, Times New Roman, serif`; reading text uses the system sans stack and metadata uses the system monospace stack. Tailwind utilities are the page-level styling contract; shared patterns remain in `global.css` under Tailwind `@layer`, with colors, type, spacing, and responsive values sourced from `tailwind.config.mjs`.

## Task #19 ownership and isolation

Task #19 owns the v0.5 homepage/layout implementation, its Tailwind tokens, responsive/a11y/browser tests, screenshots, README/design contract, and this handoff. It does not modify `.github/workflows/**`, `config/sources.json`, source adapters, crawler/cron policy, Cloudflare/deploy code, or production content. The Source Policy wording and machine semantics remain unchanged; only its footer link and existing page presentation are in scope.

## v0.5 page and navigation contract

The home route is a text-led folio rather than a generic card dashboard:

- a narrow spine/folio with the large `049` mark and stable profile facts;
- a ruled paper sheet with the large Japanese name `周防 桃子`, the Latin name, and the opening chapter copy;
- three navy chapter entrances: `01 STORIES`, `02 SONGS`, and `03 LITTLE THINGS`;
- responsive 320px+ layout with the v0.5 spacing and page proportions, no official image or SVG asset;
- Stories, Songs, Performances, and About in the main navigation; Source Policy only as a footer link and in its policy page.

Stable site facts and the Momoko introduction are real, maintainable static content. Dynamic news, songs/live, and anniversary material remains explicitly `DEMO` or an honest empty state until a reviewed source package exists. The package boundary is unchanged: production uses the reviewed-current validated package only; test/dev visual content requires the explicit package mode and manifest.

## Accessibility and progressive enhancement

The native `<details>` mobile menu is the no-JavaScript truth. JavaScript only focuses the first link on open, returns focus to the summary on close/Escape, and never uses dialog semantics. Search and URL filters preserve static no-JS content. Browser tests cover keyboard order, focus return, URL truth, console/page errors, external-request absence, overflow at 320/375/1440, 200% zoom, forced colors, reduced motion, and axe-core representative routes.

The successor's a11y test checks both the token contrast ratios and the actual selectors for `.masthead-kicker`, `.folio-chapter-label`, `.folio-song-card-kicker`, `.folio-issue`, `.folio-color-value`, `.chapter-index-code`, and `.chapter-index-arrow`. The original bright folio colors are not used as small semantic text on light surfaces.

## Artifact and data boundary

`PUBLIC_BUILD=1` rejects content overrides and renders the truthful trilingual empty state. Public artifacts contain no DEMO fixtures, draft/stale/retracted material, scraped body, official images, lyrics, dialogue, audio, secret-shaped value, crawler, deployment job, or external write. The explicit visual-demo package is local/test-only, marked visibly in all three locales, and is never treated as production truth. No real-source fetch, copyrighted asset hosting, deployment, or production write was performed for this task.

## Validation recorded for this successor

- focused contrast/visual unit tests: **19 passed**;
- full `pnpm test`: **147 passed** across 13 files;
- `pnpm check`: **0 errors / 0 warnings / 0 hints**;
- existing browser visual/a11y suite remains **20 passed**;
- default build **24 pages**; public build **24 pages / 28 postbuild files**; public audit **OK**;
- `pnpm build:verify`: **28 files byte-identical**; `git diff --check` clean;
- the structure checkpoint passed independent visual/UX review; exact-head hosted CI and the successor re-peer remain required before final GO.

The successor's hosted CI and peer must be evaluated only on the new exact head. Evidence from `c733be97...` proves the unchanged v0.5 direction/non-regression gates, but does not prove the successor's two repaired contracts.
