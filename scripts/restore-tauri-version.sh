#!/usr/bin/env bash
# scripts/restore-tauri-version.sh
#
# Companion to scripts/stamp-tauri-version.sh — reverts the version
# fields in src-tauri/tauri.conf.json and src-tauri/Cargo.toml to their
# pre-stamp values (issue #1588 acceptance criterion: "restored to their
# pre-build values after").
#
# The script is intentionally idempotent and never-destructive: if the
# current version does not match the stamped value (e.g. a downstream
# step already edited the file, or the stamp was a no-op), it logs and
# exits 0 instead of clobbering the file.
#
# Usage:
#   bash scripts/restore-tauri-version.sh   # uses default paths

set -euo pipefail

CONF_PATH="${CONF_PATH:-src-tauri/tauri.conf.json}"
CARGO_PATH="${CARGO_PATH:-src-tauri/Cargo.toml}"
STATE_FILE="${STAMP_STATE:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/tauri-version-stamp.env}"

if [[ ! -f "$STATE_FILE" ]]; then
  echo "[restore-tauri-version] No state file at $STATE_FILE — nothing to restore."
  exit 0
fi

# shellcheck disable=SC1090
source "$STATE_FILE"

if [[ "${STAMPED:-false}" != "true" ]]; then
  echo "[restore-tauri-version] STAMPED was not true in $STATE_FILE — nothing to restore."
  rm -f "$STATE_FILE"
  exit 0
fi

for v in ORIG_CONF_VERSION ORIG_CARGO_VERSION NEW_VERSION; do
  if [[ -z "${!v:-}" ]]; then
    echo "::error::Restore state file $STATE_FILE is missing $v" >&2
    exit 1
  fi
done

for tool in jq sed awk; do
  if ! command -v "$tool" >/dev/null 2>&1; then
    echo "::error::Required tool '$tool' is not on PATH" >&2
    exit 1
  fi
done

# -- Revert tauri.conf.json ---------------------------------------------
CURRENT_CONF=$(jq -r '.version' "$CONF_PATH")
if [[ "$CURRENT_CONF" == "$NEW_VERSION" ]]; then
  tmp=$(mktemp)
  # shellcheck disable=SC2064
  trap "rm -f '$tmp'" EXIT
  jq --arg v "$ORIG_CONF_VERSION" '.version = $v' "$CONF_PATH" > "$tmp"
  mv "$tmp" "$CONF_PATH"
  echo "[restore-tauri-version] Restored $CONF_PATH: $CURRENT_CONF -> $ORIG_CONF_VERSION"
else
  echo "[restore-tauri-version] $CONF_PATH already at $CURRENT_CONF (not $NEW_VERSION); skipping revert."
fi

# -- Revert Cargo.toml --------------------------------------------------
CURRENT_CARGO=$(awk -F'"' '/^version[[:space:]]*=/{print $2; exit}' "$CARGO_PATH")
if [[ "$CURRENT_CARGO" == "$NEW_VERSION" ]]; then
  ESCAPED_NEW=${NEW_VERSION//\//\\/}
  ESCAPED_ORIG=${ORIG_CARGO_VERSION//\//\\/}
  sed -i.bak "s|^version = \"${ESCAPED_NEW}\"|version = \"${ESCAPED_ORIG}\"|" "$CARGO_PATH"
  rm -f "${CARGO_PATH}.bak"
  echo "[restore-tauri-version] Restored $CARGO_PATH: $CURRENT_CARGO -> $ORIG_CARGO_VERSION"
else
  echo "[restore-tauri-version] $CARGO_PATH already at $CURRENT_CARGO (not $NEW_VERSION); skipping revert."
fi

# Clean up the state file so a re-run of the job does not see stale data.
rm -f "$STATE_FILE"
