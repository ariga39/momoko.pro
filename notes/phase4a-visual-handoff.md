# Phase 4A visual experience handoff

Status: task #20 successor from current main `fc97046cdd9583efe372689e71749785cb253612`. This candidate implements the accepted v0.5 folio direction plus server-side root locale negotiation, the selected grey-blue wordmark, and the homepage navigation correction. It does not deploy, fetch a real source, or write to Cloudflare/production. The exact candidate SHA and Draft PR are recorded after the final local gates.

## Runtime and locale contract

- Astro runs in server mode with `@astrojs/cloudflare`; `astro.config.mjs` uses `routing: "manual"` so the server-owned `/` and `/locale-switch` seams coexist with `/search`.
- `/` returns a 302 to the first supported locale from `momoko_locale`, `Accept-Language` (`zh`, `ja`, `en`), then fixed fallback `ja`.
- `/zh/...`, `/ja/...`, and `/en/...` are explicit canonical URLs and never negotiate again. The locale switch keeps the current path/detail slug, writes only the whitelist cookie with safe attributes, and rejects external/invalid `next` values.
- Existing canonical/hreflang and reviewed-current/fallback truth remains unchanged. Source Policy stays a footer link; it is not a top-level nav item.

## Visual and navigation contract

The v0.5 visual language is a narrow editorial folio: warm paper, ink-blue reading text, Momoko pink, restrained brass, ruled pages, a fine rule, and three chapter entrances. Tailwind utilities remain the page-level styling contract; shared patterns stay in `global.css` under Tailwind `@layer`, with design values sourced from `tailwind.config.mjs`.

The homepage uses the user-selected grey-blue `public/momoko-logo.svg` unchanged (SHA-256 `aaa29433b3996850b1c482c4cfe19865294876751d388ee2d1437af62b99dbe7`). Its metadata/viewBox/outlined paths are preserved. Libre Baskerville and Nunito OFL-1.1 attribution is shipped in `public/LibreBaskerville-OFL.txt` and `public/Nunito-OFL.txt`; no remote font or image request is used.

- Stable profile facts and the Momoko introduction are real static content; dynamic editorial material remains explicitly DEMO or an honest empty state until a reviewed source package exists.
- On desktop the homepage masthead has only the wordmark, locale/necessary utility, and no middle global-nav row. `01/02/03` is the homepage's only primary chapter entry and has its own trilingual `nav` landmark.
- Inner pages retain the full global navigation. The homepage's compact mobile menu remains available so all sections stay reachable at small widths.
- The meaningless `049` label and `momoko.pro / editorial desk` wording are removed. The footer identifies the site plainly as an unofficial Momoko archive; Source Policy remains only in the footer and its own page.
- The responsive matrix is 320/375/768/1024/1280/1440/1600/1920/2048px with no document overflow or empty right-column hole. Committed visual checkpoints cover the homepage at 768, 1024, and 2048px.

## Accessibility and progressive enhancement

The native `<details>` mobile menu is the no-JavaScript truth. JavaScript only focuses the first link on open, returns focus to the summary on close/Escape, and never uses dialog semantics. Browser coverage includes keyboard/focus return, URL/no-JS truth, console/page errors, external-request absence, overflow, 200% zoom, forced colors, reduced motion, and axe-core representative routes.

## Artifact and data boundary

`PUBLIC_BUILD=1` rejects content overrides and renders the truthful trilingual empty state. Public artifacts contain no DEMO fixtures, draft/stale/retracted material, scraped body, official/copyrighted media, lyrics, dialogue, audio, secret-shaped value, crawler, deployment job, or external write. The only image-shaped public asset is the checked-in site-owned wordmark, whose exact hash and font attribution are audited. The explicit visual-demo package is local/test-only and never production truth.

## Validation

- `pnpm check`: 0 errors / 0 warnings / 0 hints.
- Full Vitest suite: **150 passed**, 14 files.
- `pnpm exec playwright test e2e/site.smoke.spec.ts`: **17 passed**.
- `pnpm exec playwright test e2e/phase4a.visual.spec.ts`: **7 passed**, including the 320/375/768/1024/1280/1440/1600/1920/2048 overflow matrix, axe/keyboard/media gates, and committed 768/1024/2048 checkpoints.
- Production/public artifact boundary: **5 passed**; logo hash/metadata and OFL attribution audited; public manifest remains empty.
- `pnpm build:verify`: **40 files byte-identical**; `git diff --check` clean.

No real-source fetch, private-data read, deployment, Cloudflare write, or production write was performed. Hosted CI, independent exact-head peer, and final merge remain the next delivery gates.
