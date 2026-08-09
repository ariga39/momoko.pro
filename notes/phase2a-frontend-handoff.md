# Phase 2A frontend experience — rebuild handoff

Task #6 (momoko 2026-08-09). Rebuilt from current GitHub main
`2ee05244527564e423c0aeb4cb4990ec4c8dbb8e` (after task #9 i18n docs + task #10
lint/check infra merged).

## Scope delivered

- **Tailwind CSS** (`tailwind.config.mjs`, `postcss.config.mjs`, `src/styles/global.css`):
  color tokens with WCAG AA contrast (bg/text/text-secondary/accent/link),
  typography/spacing; skip-link + `:focus-visible` + `prefers-reduced-motion`
  base layer.
- **Astro native i18n** (`astro.config.mjs`): `locales=["ja","zh","en"]`,
  `defaultLocale="ja"`, `routing={prefixDefaultLocale:true, redirectToDefaultLocale:false}`;
  `/` remains the explicit x-default language-selector page.
- **Paraglide UI catalog** (`messages/{ja,zh,en}.json`, `project.inlang/`):
  type-safe UI chrome messages (nav, buttons, status, footer, about, policy).
  Compiled to `src/paraglide/**` (gitignored, auto-generated at build).
- **Routes**: `/` selector; `/ja /zh /en` news archive; `/<lang>/news/<slug>/`
  detail (real-translation page self-canonical + noindex vs fallback page
  `noindex,follow` + source-language canonical per design §1.2); `/search`
  (deterministic local index); `/<lang>/about/`; `/<lang>/source-policy/`; `/404`.
- **Components**: `SiteLayout` (skip-link/nav/lang-switcher/footer/canonical/
  hreflang/alternates/robots), `LanguageSwitcher` (astro:i18n paths), `NewsCard`,
  `NewsList`.
- **a11y/testable**: `src/lib/a11y.ts`, `tools/schema/css-tokens.ts`,
  `tests/a11y.test.ts` (AA contrast, reduced-motion, skip-link, Paraglide
  catalog key parity + explicit missing-locale message).

## Ownership notes

- `eslint.config.js`: one-line `src/paraglide/**` ignore added (generated output
  must not be linted). No other root-config/workflow changes (task #10 owns
  those; the rest is main's).
- `astro.config.mjs` i18n + Paraglide compile hook are feature-owned.
- No changes to `tools/ingest/**`, source adapters, or deploy workflows.

## Verification (cold, in dedicated worktree)

- `pnpm check` (ESLint + `astro check`) clean; `pnpm test` 26 passed;
  `pnpm build:verify` 21 files byte-identical; `pnpm test:e2e` 8/8
  (incl. real-vs-fallback robots/canonical, lang switcher, keyboard nav, 404).
- Worktree: `/home/raft/worktrees/momoko-phase2a`, branch
  `phase2a/frontend-experience-rebuild`.
