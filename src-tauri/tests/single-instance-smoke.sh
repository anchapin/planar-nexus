#!/usr/bin/env bash
# Regression test for issue #1441 — verifies that a second launch of the
# Tauri desktop binary does not start a second live process: the plugin
# forwards the launch event to the existing instance (which focuses its
# main window) and exits the second process.
#
# This is a smoke test, not a CI gate. It requires a display server
# (Wayland/X11) and a built debug binary — it is invoked manually with
# `bash src-tauri/tests/single-instance-smoke.sh` after
# `cargo build --bin planar-nexus-desktop`.
#
# What it asserts:
#   1. First launch starts a live process holding the binary name.
#   2. Second launch exits within a short timeout.
#   3. Process count for the binary name does not exceed 1 after both
#      launches complete.
set -euo pipefail

BIN="${BIN:-target/debug/planar-nexus-desktop}"
WORKDIR="${WORKDIR:-$(mktemp -d)}"
LOG1="$WORKDIR/inst1.log"
LOG2="$WORKDIR/inst2.log"
PIDFILE="$WORKDIR/inst1.pid"

if [[ ! -x "$BIN" ]]; then
  echo "skip: $BIN not built (run: cargo build --bin planar-nexus-desktop)"
  exit 0
fi

cleanup() {
  if [[ -f "$PIDFILE" ]]; then
    kill "$(cat "$PIDFILE")" 2>/dev/null || true
  fi
  rm -rf "$WORKDIR"
}
trap cleanup EXIT

echo "launching first instance..."
"$BIN" >"$LOG1" 2>&1 &
echo $! >"$PIDFILE"
FIRST_PID="$(cat "$PIDFILE")"

# Give the webview time to come up.
sleep 4

if ! kill -0 "$FIRST_PID" 2>/dev/null; then
  echo "FAIL: first instance died — see $LOG1"
  exit 1
fi

echo "launching second instance (should hand off to first)..."
set +e
timeout 5 "$BIN" >"$LOG2" 2>&1
SECOND_RC=$?
set -e

if [[ "$SECOND_RC" -eq 124 ]]; then
  echo "FAIL: second instance did not exit within 5s — single-instance not enforced"
  exit 1
fi

# At this point the first instance should still be alive and there should
# be exactly one process matching the binary name (excluding the current
# shell, which is unrelated).
LIVE_COUNT="$(pgrep -x "$(basename "$BIN")" | wc -l)"
if [[ "$LIVE_COUNT" -ne 1 ]]; then
  echo "FAIL: expected 1 live process, found $LIVE_COUNT"
  pgrep -x "$(basename "$BIN")" || true
  exit 1
fi

echo "OK: single instance enforced (first PID=$FIRST_PID still alive, second exited rc=$SECOND_RC)"