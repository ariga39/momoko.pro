#!/usr/bin/env bash
# Run the FULL Playwright browser suite (smoke + link crawl + visual) in the
# canonical runner-matching container (pinned by DIGEST below). Same
# environment as scripts/regenerate-visual-baselines.sh — use this to verify
# any change that can affect rendering or routes against the exact environment
# hosted CI uses.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIGEST="catthehacker/ubuntu@sha256:b839c14c4410998529ec18f951262bdf87a2b23bc1467304d07b491b9455e074"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

tar czf "$TMP/src.tar.gz" \
  --exclude='node_modules' --exclude='dist' --exclude='dist-public' \
  --exclude='dist-visual-e2e' --exclude='.wrangler' --exclude='test-results' \
  --exclude='.git' -C "$REPO_ROOT" .

docker run --rm \
  -v "$TMP/src.tar.gz":/work/src.tar.gz \
  "$DIGEST" \
  bash -lc 'set -e
    mkdir -p /work/app && tar xzf /work/src.tar.gz -C /work/app && cd /work/app
    (corepack enable 2>/dev/null || true)
    (pnpm --version >/dev/null 2>&1 || npm i -g pnpm@9.15.9 >/dev/null 2>&1)
    pnpm install --frozen-lockfile >/dev/null 2>&1
    pnpm exec playwright install --with-deps chromium >/dev/null 2>&1
    pnpm test:e2e'

echo "Full browser suite finished (exit $?)."
