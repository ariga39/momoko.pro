# Visual baseline environment contract

The repository commits Playwright `-linux` screenshot baselines because hosted
CI renders on the GitHub Actions **ubuntu-24.04** runner. Any change that
legitimately alters rendering (navigation, layout, fonts, content) requires
regenerating those baselines in the **same environment CI uses** — otherwise
the visual gate fails with font/line-metric noise instead of real diffs.

## Canonical environment

| Component | Source |
|---|---|
| Image | `catthehacker/ubuntu:act-24.04` @ digest `sha256:b839c14c4410998529ec18f951262bdf87a2b23bc1467304d07b491b9455e074` (replicates the runner's base packages and system font set) |
| Node | Provided by the image (24.x line, matching CI `setup-node node-version: 24`) |
| pnpm | `9.15.9` (repo `packageManager`), via corepack or `npm i -g pnpm@9.15.9` fallback |
| Playwright | `1.62.1` (lockfile) |
| Chromium | `pnpm exec playwright install --with-deps chromium` — `--with-deps` installs the same apt font packages the runner's CI step installs |
| Fonts | System fonts of the act-24.04 image + fonts installed by `playwright install --with-deps` (same sources as hosted CI) |

## Entry points (only these may update baselines)

- `scripts/regenerate-visual-baselines.sh` — regenerates
  `e2e/phase4a.visual.spec.ts-snapshots/*-linux.png` in the container above.
  It packs the working tree (excluding host platform artifacts), installs deps
  inside the container, runs the visual spec with `--update-snapshots`, and
  copies the `-linux` PNGs back into the repo.
- `scripts/run-browser-suite.sh` — runs the full `pnpm test:e2e` suite in the
  same container for verification.

## Rules

1. Only update snapshots that genuinely changed because of the current
   source change; never bulk-accept a CI pixel mismatch.
2. If CI reports a pixel mismatch after a regeneration, do NOT keep rolling
   the baselines — investigate the environment contract first (fonts,
   chromium version, content package).
3. A CI failure artifact's `-actual.png` may be used as independent
   reconciliation evidence (0-pixel diff), not as the baseline source —
   baselines must come from `scripts/regenerate-visual-baselines.sh`.
4. Docker is a local validation tool: no image is pushed, no deployment
   happens from these scripts.
