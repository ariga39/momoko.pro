# momoko.pro

momoko.pro is a small, unofficial, trilingual archive for Suō Momoko. It is a static Astro site for `zh`, `ja`, and `en`; stable character information is kept separate from reviewed editorial packages.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test
pnpm build:verify
```

The production/public build is intentionally empty until a reviewed-current content package is supplied. Synthetic editorial fixtures are available only through an explicit test or development mode and are never production content.

## Frontend styling contract

- Pages use Tailwind CSS utilities first.
- Shared patterns belong in `src/styles/global.css` inside Tailwind `@layer` blocks.
- Colors, typography, spacing, and other design values come from `tailwind.config.mjs` theme tokens.
- Do not introduce a parallel global CSS system or one-off un-tokenized design values.
- Responsive behavior starts at 320px, preserves keyboard and no-JavaScript readability, and respects reduced-motion, forced-colors, and 200% zoom.

## Content and source boundary

This is an unofficial fan site. It does not reproduce official images, logos, lyrics, dialogue, audio, or fetched article bodies. Source decisions, correction policy, and current access status are documented in the [Source Policy](/source-policy/) page. Publication requires a reviewed-current content package and an explicit human review record.
