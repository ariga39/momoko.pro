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
- News archive: intro, URL-backed filter chips, featured note, two-column desktop cards, month rail; mobile wraps chips and stacks cards.
- News detail: back link, metadata rail, title/body, source/correction panel, related notes; metadata precedes title on mobile.
- Encyclopedia: intro, index chips, portrait-free dossier cards, aliases/tags, related notes; one stack at 320px.
- Songs/live: year/type URL controls, timeline and compact table on desktop; numbered cards with date/type/title/source on mobile.
- Anniversary: milestone stats and year/month grid; two columns at 375px and one at 320px.
- Search: labelled form and full static list as no-JS truth; JS only filters and updates an `aria-live` region.
- About/source policy: policy cards and workflow/correction callout; task #18's merged policy facts are displayed but not rewritten.

## DEMO and production boundary

The explicit `tests/fixtures/content-package/visual-demo` package has a versioned manifest, a schema-validated `visual-catalog.json`, and schema-valid news records. Its notice is required in all three locales and visibly says `DEMO`/`架空示例`; it contains no official images, logos, lyrics, audio, scraped body, or source claim. It is selected only through the existing `MOMOKO_CONTENT_PACKAGE_ROOT` plus `MOMOKO_CONTENT_PACKAGE_MODE=test|dev` contract. There is no independent preview switch.

`PUBLIC_BUILD=1` rejects all content overrides and resolves the checked-in `content/package.json` empty package. Public builds therefore render the truthful trilingual empty state and cannot include a demo title, slug, body, search row, or visual catalog. This boundary is tested before visual pages are expanded.

## Progressive enhancement and test matrix

The mobile menu uses native `<details>` as the no-JS truth. JavaScript only focuses the first link on open, returns focus to the summary on close/Escape, and never uses dialog semantics. Search and filters use URL/query state and retain the complete static list; enhancement updates a live region. Screenshots cover `zh/ja/en` long-title states at 320/375/768/1024/1440, 200% zoom, reduced motion, and forced colors. Playwright checks keyboard order, skip link, menu state/focus, language links, URL filters, DOM overflow, console errors, and visible DEMO labeling. Axe-equivalent checks cover landmarks, headings, accessible names, duplicate IDs, focus-visible, and live-region behavior. Baselines are test-only and use a 0.2% diff threshold with animation/time disabled.

## First implementation checkpoint

The new base and ownership boundary are recorded above. The first red tests are in `tests/phase4a-visual.test.ts` and cover:

1. loading the schema-valid visual package and deriving a DEMO catalog;
2. production-empty behavior under `PUBLIC_BUILD=1`;
3. native details markup, Escape/focus-return hooks, and non-dialog semantics;
4. deterministic URL-backed year/type filter parsing and serialization.

At the checkpoint, the tests intentionally fail because the visual loader, native mobile shell, and URL filter module have not yet been implemented. No page, source-policy fact, deployment, or real network behavior is changed by this checkpoint.
