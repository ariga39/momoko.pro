# Task #33 i18n navigation / root negotiation / link crawl handoff

Status: task #33 (Astro i18n 导航 / 根协商 / 全站链接爬测) — author @reon, independent from exact live main `461ab12ee420e8c33c04e22712bd984756bc5489`, supervisor @momoko. No deploy, no Cloudflare write, no task #31/PR #18 modifications.

## Problem (from user report + repro matrix)

- `routing: "manual"` made `getRelativeLocaleUrl()` emit **prefix-less links for the default locale ja** (`/news/`, `/songs-live/`, `/about/`, `/source-policy/`), all 404. zh/en had prefixes so sampling missed it.
- `/search` and the generic 404 were hardcoded Japanese; language-switch helper lost the current path on prefix-less pages.
- Home chapter nav (3 items) and inner-page global nav (4 items) were inconsistent; Encyclopedia and Search were missing from menus.
- `/` was implemented as a hand-set status/location in a page, not a complete i18n router loop; no full-route/full-link evidence existed.

## Change (per Astro official i18n docs)

1. `astro.config.mjs`: `routing: { prefixDefaultLocale: true, redirectToDefaultLocale: false }` — every locale URL-prefixed, default locale included; the built-in `/` redirect stays disabled so the custom negotiation owns the root.
2. `src/middleware.ts`: `/` → negotiated 302 to `/{lang}/`; legacy `/search` → negotiated 303 to `/{lang}/search/` (both via `context.redirect`; the prefix-always built-in middleware would 404 non-locale routes, so the seam lives in middleware; `src/pages/index.astro` deleted).
3. Search moved to `src/pages/[lang]/search/index.astro` with localized form action; old `/search` redirects only.
4. `src/pages/404.astro`: language from request path → cookie → Accept-Language → ja; real 404 status preserved.
5. `src/components/SiteLayout.astro` + `src/pages/[lang].astro`: unified six-item menu (Stories / Encyclopedia / Songs & Live / Anniversaries / About / Search) on home chapter index and inner global nav; Source Policy footer-only.
6. `SiteLayout` default alternates now derive exact localized siblings from `canonicalPath` instead of hardcoded home URLs (list/search pages previously emitted wrong hreflang).
7. Docs updated: `docs/adr.md` (ADR-12 路由行), `docs/design.md` (§1.2 三语路由).

## Tests (new + updated)

- `e2e/i18n-link-crawl.spec.ts` (new, 9 tests): BFS internal-link crawl from the three locale homes (status/locale/canonical-hreflang/prefix-less assertions, entity-decoded hrefs, static-asset + external + mailto/hash exclusions, node budget, same-origin redirect following); root negotiation matrix (cookie > Accept-Language q-values > default ja, relative same-origin 3xx); legacy `/search` 303; true-404 with language by path vs negotiation; six-item menu consistency; localized form action; canonical/hreflang exact siblings (home/list/detail/search); language-switch same-path with query preserved; no unexpected prefix-less links.
- `e2e/site.smoke.spec.ts` (updated): localized search route, 404 language semantics, six home chapters.
- Visual baselines `-linux` regenerated in a Linux container (nav changed).
- Unit 168 pass, lint 0, typecheck 0, smoke+crawl E2E 35 pass.

## Handoff

```text
task / owner / peer
base SHA: 461ab12ee420e8c33c04e22712bd984756bc5489
exact head SHA / PR: <filled after push>
hosted CI run + terminal result: <filled after push>
changed scope: astro.config.mjs, src/middleware.ts, src/pages/{404,[lang],[lang]/search,index,search}.astro,
  src/components/SiteLayout.astro, docs/{adr,design}.md, e2e/{i18n-link-crawl,site.smoke}.spec.ts, snapshots
submitted tests: 9 crawl + updated smoke; unit 168; lint/typecheck clean
privacy/secret scan: no credentials touched; wrapper ls-remote only; no secret output
external-write statement: none (no deploy, no Cloudflare write, no live GET beyond local worker)
remaining blocker / next owner: hosted CI terminal state + independent peer exact-head review (peer seat @momoko to route); visual baselines regenerated on linux
```
