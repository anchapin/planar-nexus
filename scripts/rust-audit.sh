#!/bin/bash
# Local wrapper for `cargo audit` that mirrors the GitHub Actions job.
# Resolves #1275. Run from the repo root, or invoke via `npm run` once
# wired in package.json.
#
# Behaviour matches `.github/workflows/ci.yml` `cargo-audit`:
#   - emits JSON next to Cargo.lock for review,
#   - fails on advisories with severity >= high,
#   - reports (but does not gate) unmaintained / unsound warnings
#     that the inherited gtk-rs GTK3 binders raise on Linux.

set -euo pipefail

if ! command -v cargo >/dev/null 2>&1; then
    echo "❌ cargo not found on PATH. Install rustup: https://rustup.rs/" >&2
    exit 127
fi

if ! command -v cargo-audit >/dev/null 2>&1; then
    echo "📦 installing cargo-audit (matches CI pinned version)..."
    cargo install cargo-audit --locked --version '^0.22'
fi

if [ ! -f src-tauri/Cargo.toml ]; then
    echo "❌ src-tauri/Cargo.toml not found; run from the repo root." >&2
    exit 1
fi

echo "🔍 running cargo audit on src-tauri/..."
REPORT=src-tauri/cargo-audit.json
( cd src-tauri && cargo audit --json >cargo-audit.json ) || AUDIT_EXIT=$?
set -e

REPORT="$REPORT" python3 - <<'PY'
import json, os
path = os.environ["REPORT"]
with open(path) as fh:
    data = json.load(fh)

vulns = (data.get("vulnerabilities") or {}).get("list") or []
order = {"low": 1, "moderate": 2, "medium": 2, "high": 3, "critical": 4}
threshold = order["high"]

failing = []
for v in vulns:
    sev = (v.get("advisory") or {}).get("severity") or ""
    pkg = (v.get("package") or {}).get("name", "?")
    ver = (v.get("package") or {}).get("version", "?")
    aid = (v.get("advisory") or {}).get("id", "?")
    title = (v.get("advisory") or {}).get("title", "")
    if order.get(sev, 0) >= threshold:
        failing.append(f"  {aid}: {pkg}@{ver} [{sev}] {title}")

warnings = data.get("warnings") or {}
for kind, items in warnings.items():
    print(f"  ⚠  {len(items)} {kind} advisory(s) — informational, review docs/RUST_UPGRADE_STRATEGY.md")

if failing:
    print(f"\n❌ {len(failing)} advisory(s) at severity >= high:")
    for line in failing:
        print(line)
    sys.exit(1)

print(f"✅ {len(vulns)} advisory(s); none at severity >= high")
PY

if [ "${AUDIT_EXIT:-0}" -ne 0 ]; then
    echo "❌ cargo audit exited ${AUDIT_EXIT}; full report at src-tauri/cargo-audit.json" >&2
    exit "${AUDIT_EXIT}"
fi

echo "📄 JSON report: src-tauri/cargo-audit.json"
