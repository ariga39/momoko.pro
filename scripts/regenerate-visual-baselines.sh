#!/usr/bin/env bash
# Regenerate Playwright visual baselines in the canonical runner-matching
# environment. This is the ONLY supported entry for updating -linux snapshots.
#
# Why this container: the image pinned by DIGEST below replicates the GitHub
# Actions ubuntu-24.04 runner environment (same base packages and system font
# set), which is what hosted CI renders with. Snapshots generated here are
# pixel-identical to CI (verified: 0-pixel diff against a CI failure artifact).
#
# The image tag is mutable; the DIGEST below is the auditable pin.
# Node / pnpm / Playwright / Chromium and font sources:
#   - image: the DIGEST below (ubuntu-24.04-compatible runner font set)
#   - pnpm: 9.15.9 (repo packageManager, via corepack or npm -g fallback)
#   - playwright: 1.62.1 (lockfile) with chromium via `playwright install
#     --with-deps chromium` (fonts installed by --with-deps match the runner)
#   - node: as provided by the image (24.x line, same as CI setup-node)
#
# Usage: scripts/regenerate-visual-baselines.sh
# Result: e2e/phase4a.visual.spec.ts-snapshots/*-linux.png regenerated in place.
# Only run this when a source change legitimately alters rendering (e.g. nav),
# never to absorb a CI pixel mismatch — investigate the environment contract
# first.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIGEST="catthehacker/ubuntu@sha256:b839c14c4410998529ec18f951262bdf87a2b23bc1467304d07b491b9455e074"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# Pack the working tree without platform-specific build artifacts so the
# container installs its own linux node_modules (host node_modules are darwin).
tar czf "$TMP/src.tar.gz" \
  --exclude='node_modules' --exclude='dist' --exclude='dist-public' \
  --exclude='dist-visual-e2e' --exclude='.wrangler' --exclude='test-results' \
  --exclude='.git' -C "$REPO_ROOT" .

mkdir -p "$TMP/out"

docker run --rm \
  -v "$TMP/src.tar.gz":/work/src.tar.gz \
  -v "$TMP/out":/out \
  "$DIGEST" \
  bash -lc 'set -e
    mkdir -p /work/app && tar xzf /work/src.tar.gz -C /work/app && cd /work/app
    (corepack enable 2>/dev/null || true)
    (pnpm --version >/dev/null 2>&1 || npm i -g pnpm@9.15.9 >/dev/null 2>&1)
    pnpm install --frozen-lockfile >/dev/null 2>&1
    pnpm exec playwright install --with-deps chromium >/dev/null 2>&1
    pnpm exec playwright test e2e/phase4a.visual.spec.ts --update-snapshots
    cp e2e/phase4a.visual.spec.ts-snapshots/*-linux.png /out/'

cp "$TMP/out"/*-linux.png "$REPO_ROOT/e2e/phase4a.visual.spec.ts-snapshots/"
echo "Regenerated visual baselines in e2e/phase4a.visual.spec.ts-snapshots/"
echo "Verify: run the full browser suite in the same container (scripts/run-browser-suite.sh)"
