#!/usr/bin/env bash
# Remove the task-owned build outputs that the real-content E2E (playwright.real
# config) regenerates deterministically. Explicit relative paths only — never a
# broad rm — so the cleanup is scoped to this task's artifacts and safe to run.
set -euo pipefail
cd "$(dirname "$0")/.."
for dir in dist-public .astro .wrangler; do
  if [ -d "$dir" ]; then rm -rf "$dir"; fi
done
