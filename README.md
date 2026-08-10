# momoko.pro

momoko.pro is a small, unofficial, trilingual archive for Suō Momoko. It is an Astro server-rendered site on Cloudflare Pages Functions for `zh`, `ja`, and `en`; stable character information is kept separate from reviewed editorial packages.

## Local development

```sh
pnpm install --frozen-lockfile
pnpm dev
pnpm check
pnpm test
pnpm build
pnpm build:verify
```

The server build uses `@astrojs/cloudflare`. The root route negotiates a locale on the server (`momoko_locale` cookie, then `Accept-Language`, then `ja`); localized routes remain explicit and canonical. Browser tests use Wrangler locally with the built worker and `dist` assets.

The homepage masthead uses the checked-in grey-blue `public/momoko-logo.svg` wordmark. Its outlined paths carry Libre Baskerville and Nunito OFL-1.1 attribution in `public/LibreBaskerville-OFL.txt` and `public/Nunito-OFL.txt`; no remote font or image request is made. On desktop the homepage exposes its three chapter links as the primary navigation landmark, while inner pages retain the full global navigation and the mobile menu remains available on every page.

The production/public build is intentionally empty until a reviewed-current content package is supplied. Synthetic editorial fixtures are available only through an explicit test or development mode and are never production content.

## Frontend styling contract

- Pages use Tailwind CSS utilities first.
- Shared patterns belong in `src/styles/global.css` inside Tailwind `@layer` blocks.
- Colors, typography, spacing, and other design values come from `tailwind.config.mjs` theme tokens.
- Do not introduce a parallel global CSS system or one-off un-tokenized design values.
- Responsive behavior starts at 320px, preserves keyboard and no-JavaScript readability, and respects reduced-motion, forced-colors, and 200% zoom.

## Content and source boundary

This is an unofficial fan site. It does not reproduce official images, logos, lyrics, dialogue, audio, or fetched article bodies. Source decisions, correction policy, and current access status are documented in the [Source Policy](/source-policy/) page. Publication requires a reviewed-current content package and an explicit human review record.
