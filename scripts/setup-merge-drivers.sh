#!/usr/bin/env bash
# Register the local git merge driver used by .gitattributes (#2487).
#
# The test-count docs (`docs/onboarding.md`, `docs/TEST_VIDEO_FIXTURES.md`)
# are ratcheted by `npm run ratchet:test-count` after every successful Jest
# run, so two PRs touching the doc at the same anchor can conflict at the
# `<!-- TEST_COUNT:START -->` block. .gitattributes pins those docs to the
# custom `keepcurrent` driver, which always keeps the current side (the
# side being merged INTO) and exits 0 — the next `npm run
# ratchet:test-count` rewrites the block to the latest live numbers, and
# `test-count-docs-guard` still fails CI on drift.
#
# Run once per machine:
#   npm run setup:merge-drivers
#
# Idempotent.

set -euo pipefail

NAME="keepcurrent"
DRIVER="git merge-file --ours %A %O %A"

current_driver="$(git config --get "merge.$NAME.driver" || true)"
if [ "$current_driver" = "$DRIVER" ]; then
  echo "[setup-merge-drivers] merge driver '$NAME' already registered."
  exit 0
fi

git config "merge.$NAME.driver" "$DRIVER"
echo "[setup-merge-drivers] registered merge driver '$NAME' (driver: $DRIVER)."
echo "[setup-merge-drivers] run 'npm run ratchet:test-count' after any rebase on the test-count docs."