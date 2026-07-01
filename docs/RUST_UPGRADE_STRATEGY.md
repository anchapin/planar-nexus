# Rust dependency-upgrade strategy

This runbook governs how the Rust crate tree in `src-tauri/` is audited and
upgraded. It mirrors the npm workflow landed in #1108 and is the contract
enforced by the `cargo-audit` job in `.github/workflows/ci.yml`. Resolves #1275.

## Tauri SDK matrix

`src-tauri/Cargo.toml` is pinned to a single Tauri 2 minor branch. The
frontend `package.json` does **not** carry Rust crates — everything Rust
lives under `src-tauri/`. Dependabot (`.github/dependabot.yml`) bundles
semver-compatible minor/patch bumps into one PR; major bumps
(Tauri 2 → 3) are ignored there and tracked in the manual roadmap.

| Crate                | Pinned line           | Cadence             |
| -------------------- | --------------------- | ------------------- |
| `tauri-build`        | `2.5` (build-dep)     | bump with `tauri`   |
| `tauri`              | `2.10` (runtime)      | weekly Dependabot   |
| `tauri-plugin-log`   | `2` (runtime plugin)  | weekly Dependabot   |

## Day-to-day upgrades

```bash
cd src-tauri && cargo update -p serde     # bump a single crate
cd src-tauri && cargo update              # bulk bump (minor Tauri release)
./scripts/rust-audit.sh                   # re-verify lock + advisory state
npm run build:tauri                       # regenerate bundle, catch stale src/
```

## Triage: cargo audit failure in CI

The `cargo-audit` job emits a JSON report (`cargo-audit-report` artefact)
and fails on advisories with `Severity: high` or above — matching the
`npm audit --audit-level=high` contract from #1108. Warnings
(`unmaintained`, `unsound`, `notice`) are surfaced but **do not block**
the build while the gtk3-rs → gtk4-rs migration is in flight.

| JSON signal                                | First action                            |
| ------------------------------------------ | --------------------------------------- |
| CVE `severity == high`/`critical`          | Patch, bump, or vendor + track          |
| `unmaintained` on the `gtk*-rs` family     | Open roadmap epic, link from this doc   |
| `unsound` on `anyhow` / `rand`             | Pin to `>= patched` in `Cargo.toml`     |
| Notice on a brand-new advisory             | Tracking issue, defer to next sweep     |

Track accepted exceptions in an `## Accepted advisories` table appended
below, mirroring the npm allowance list from #1108.

## Provenance & supply-chain

Goal: SLSA Build L3 provenance on each `tauri build` (v1.8 roadmap epic).
Until that lands, every release **must**: (1) pass the `cargo-audit` job
at severity ≥ high; (2) run `.github/workflows/release.yml` so Windows
NSIS/MSI and macOS DMG go through `signtool` / `notarytool`; (3) reference
the lock-file commit SHA in release notes so the bundle is reproducible
from source.

## See also

- `.github/dependabot.yml` — weekly `cargo` ecosystem config.
- `.github/workflows/ci.yml` — `cargo-audit` job definition.
- `scripts/rust-audit.sh` — local equivalent of the CI gate.
- `CONTRIBUTING.md` §10 — how docs like this one stay in sync.
