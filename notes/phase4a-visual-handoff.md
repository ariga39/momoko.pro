# Phase 4A visual experience handoff

Status: implementation restarted after task #18 post-merge CI. Design is GO from @momoko. The implementation baseline is the exact current main `f3e1d057434e9de46aabba4a65c114009be2c09f`, in branch `phase4a/visual-mirai-f3e1`. The previous `phase4a/visual-mirai` worktree/history is not reused.

## Direction and measurable tokens

The visual language is a small editorial archive desk: warm paper surfaces, ink-blue reading text, Momoko pink for active/focus states, and restrained brass for archive labels. Rules, folio numbers, index tabs, and CSS-only star/diamond marks provide character without official artwork or hosted media.

| Token | Value | Contract |
| --- | --- | --- |
| paper | `#fffaf4` | page background |
| paper-deep | `#f1e5d5` | panel background |
| ink | `#25212a` | 14.45:1 on paper; body text |
| ink-soft | `#5b5460` | 7.23:1 on paper; secondary text |
| momoko-pink | `#8f294b` | 7.78:1 on paper; active labels |
| momoko-pink-dark | `#6f1f3a` | pressed/hover state |
| brass | `#7a581d` | 6.32:1 on paper; archive metadata |
| link | `#0b5575` | 7.78:1 on paper; link/focus |
| white | `#ffffff` | 8.08:1 on pink; inverse text |
| line | `#d8c8bc` | non-text boundaries only |

Display type is `Iowan Old Style, Baskerville, Times New Roman, serif`; reading type is `ui-sans-serif, system-ui, Segoe UI, sans-serif`; code uses `ui-monospace`. The fluid scale is `0.75/1.1`, `0.875/1.4`, `1/1.6`, `1.125/1.6`, `clamp(1.25rem, 1.6vw + 1rem, 1.6rem)`, `clamp(1.75rem, 2vw + 1.2rem, 2.5rem)`, and `clamp(2.5rem, 5vw + 1rem, 5.5rem)`. Weights are 400/500/650/800. Spacing uses a 4px base grid, `72rem` max content width, 12 desktop columns, one mobile column, and 1.5rem/1rem grid gaps. Cards use a 0.75rem radius; pills use `999px`; focus is `3px solid #0b5575` with a 3px offset. State motion is 180ms and entrance motion 420ms; reduced motion removes both. Forced colors use Canvas/CanvasText/ButtonText/LinkText/Highlight tokens.

## Actual ownership and isolation

Task #17 owns the visual implementation in this new branch:

- `src/components/**`, `src/styles/**`, locale page/layout markup, and interaction scripts;
- the schema-validated test/dev visual package and its loader;
- visual, accessibility, and Playwright tests, screenshots, and this handoff.

Task #17 does not modify `.github/workflows/**`, `config/sources.json`, source adapters, crawler/cron code, or task #18's source-policy facts/config/schema/robots tests. The merged task #18 policy page and messages may receive visual markup/classes only; their policy wording and machine semantics remain unchanged.

## Component and route structure

```text
SiteLayout
├─ SkipLink
├─ Masthead
│  ├─ BrandMark
│  ├─ DesktopNav
│  ├─ MobileMenu (native details; Escape/focus return enhancement)
│  └─ LanguageSwitcher
├─ DemoNotice (derived from the package manifest/mode)
├─ PageIntro / SectionHeading
├─ EditorialCard / StatStrip / StatusPill / Timeline
└─ FooterPolicy
```

Routes are `/[lang]/` home, `/[lang]/news/` archive, `/[lang]/news/[...slug]/` detail, `/[lang]/encyclopedia/`, `/[lang]/songs-live/`, `/[lang]/anniversary/`, `/search`, `/[lang]/about/`, and `/[lang]/source-policy/`.

- Home: hero (editorial label/title/lede/actions plus folio stamp), status strip, three-card latest notes, archive teaser, quick links. Mobile stacks the stamp and cards without viewport overflow.
- News archive: intro, URL-backed year filter, result live region, and editorial card grid; mobile wraps controls and stacks cards.
- News detail: back link, metadata rail, title/body, source/correction panel, related notes; metadata precedes title on mobile.
- Encyclopedia: intro, index chips, portrait-free dossier cards, aliases/tags, related notes; one stack at 320px.
- Songs/live: year/type URL controls, timeline and compact table on desktop; numbered cards with date/type/title/source on mobile.
- Anniversary: milestone stats and year/month grid; two columns at 375px and one at 320px.
- Search: labelled form and full static list as no-JS truth; JS only filters and updates an `aria-live` region.
- About/source policy: policy cards and workflow/correction callout; task #18's merged policy facts are displayed but not rewritten.

## DEMO and production boundary

The explicit `tests/fixtures/content-package/visual-demo` package has a versioned manifest, a schema-validated `visual-catalog.json`, and schema-valid news records. Its notice is required in all three locales and visibly says `DEMO`/`架空示例`; it contains no official images, logos, lyrics, audio, scraped body, or source claim. It is selected only through the existing `MOMOKO_CONTENT_PACKAGE_ROOT` plus `MOMOKO_CONTENT_PACKAGE_MODE=test|dev` contract. There is no independent preview switch.

`PUBLIC_BUILD=1` rejects all content overrides and resolves the checked-in `content/package.json` empty package. Public builds therefore render the truthful trilingual empty state and cannot include a demo title, slug, body, search row, or visual catalog. The package seam itself also rejects a declared visual catalog unless the root was selected through an explicit test/dev package mode; the public manifest reader has no caller-supplied root argument.

## Progressive enhancement and test matrix

The mobile menu uses native `<details>` as the no-JS truth. JavaScript only focuses the first link on open, returns focus to the summary on close/Escape, and never uses dialog semantics. Search and filters use URL/query state and retain the complete static list; enhancement updates a live region. Playwright checks keyboard order, skip link, menu state/focus, language links, URL filters, DOM overflow at 320/375/1440, console errors, and external-request absence. The browser a11y gate runs `axe-core` 4.13.0 against representative demo home, encyclopedia, and songs/live pages; the separate media test covers 200% root-size reflow, forced colors, and reduced motion. Baselines are test-only and use a 0.2% diff threshold, CSS scale, `document.fonts.ready`, reduced motion, hidden caret, and disabled animations. The stable-font strategy is the repository's system/display/mono stacks only: no remote font or time-dependent asset is loaded.

## Implementation checkpoints

The new base and ownership boundary are recorded above. The first checkpoint (`967e7ae`, then append-only boundary successor `225f156`) added red tests in `tests/phase4a-visual.test.ts` covering:

1. loading the schema-valid visual package and deriving a DEMO catalog;
2. production-empty behavior under `PUBLIC_BUILD=1`;
3. native details markup, Escape/focus-return hooks, and non-dialog semantics;
4. deterministic URL-backed year/type filter parsing and serialization.

The boundary successor made the public override and `empty + visual_catalog` cases explicit, and added a schema-valid trilingual fictional DEMO news record. The loader/shell checkpoint is `6935b29`; it makes manifest validation and the native details/filter seams green. The follow-up boundary fix is kept in the next successor: `readContentPackageManifest()` always resolves through `getContentRoot()`, and top-level visual catalog entries are rejected for default/production packages before `loadNews()` can consume them. The expanded route/page implementation retains no-JS static truth, and does not change source-policy facts, deployment, or network behavior.

## Final visual closure evidence

The final closure candidate adds `e2e/phase4a.visual.spec.ts`. Its isolated browser fixture server builds only the explicit `visual-demo` package into `dist-visual-e2e`; it does not fetch, publish, deploy, or use an external URL. The four committed screenshot baselines are:

| Baseline | Route | Viewport | State |
| --- | --- | --- | --- |
| `phase4a-zh-detail-320-linux.png` | `/zh/news/2026/S99-visual-demo-archive-001/` | 320px | DEMO long title/detail |
| `phase4a-ja-detail-375-linux.png` | `/ja/news/2026/S99-visual-demo-archive-001/` | 375px | DEMO long title/detail |
| `phase4a-en-detail-375-linux.png` | `/en/news/2026/S99-visual-demo-archive-001/` | 375px | DEMO long title/detail |
| `phase4a-en-songs-live-1440-linux.png` | `/en/songs-live/` | 1440px | dense DEMO timeline |

Every baseline uses a maximum `0.002` pixel-difference ratio, `animations: disabled`, reduced motion, CSS scale, hidden caret, and fonts-ready synchronization. The artifact audit now builds default/public-empty, synthetic, and explicit visual-demo outputs separately; it asserts the public manifest has zero entries and no S99/DEMO fixture markers while the visual artifact has the one S99 entry and visible DEMO markers. This is an artifact-set check, not a claim that demo content is production truth.

Final machine gates to record against the frozen successor: full `pnpm test`, `pnpm check`, default/public and explicit-demo builds plus public audit, `pnpm build:verify`, `pnpm test:e2e`, `git diff --check`, and a changed-tree secret/PII scan. The exact candidate SHA, base, clean status, and these counts must be updated here before the independent visual/a11y peer is assigned.
