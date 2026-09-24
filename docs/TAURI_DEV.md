# Tauri Desktop Development Guide

> How to develop, build, and debug the Planar Nexus Tauri 2 desktop shell.

## Prerequisites

| Tool | Version / notes |
|------|----------------|
| **Rust** | Edition 2021, MSRV 1.77.2. Install via [rustup](https://rustup.rs/). |
| **Node.js** | Node 22 — same as the web app. |
| **Tauri CLI** | `cargo install tauri-cli` (or `npm install -g @tauri-apps/cli`). Run `cargo tauri --version` to confirm. |
| **WebKit** | Linux: `libwebkit2gtk-4.1-dev`. See [Tauri prereqs](https://v2.tauri.app/start/prerequisites/). |

Verify your environment:

```bash
rustc --version   # ≥ 1.77.2
cargo tauri --version
node --version    # 22.x
```

## Build Commands

### Production build

```bash
npm run build:tauri
```

This runs `prebuild:tauri` (generates a CSP nonce and injects it into `src-tauri/tauri.conf.json` and every `.next/*.html` file), then delegates to `tauri build`. The full sequence:

1. `npm run prebuild:tauri` — `scripts/inject-tauri-csp-nonce.ts` generates a per-build nonce, patches `tauri.conf.json`'s CSP, and writes it to `.next/csp-nonce.txt`.
2. `npm run build` — builds the Next.js frontend into `.next/`.
3. `tauri build` — compiles the Rust shell and bundles the installer.

The `frontendDist` in `tauri.conf.json` is `../.next`, so `tauri::generate_context!()` (in `src-tauri/src/lib.rs`) embeds those assets at compile time. Both the `.next/` directory and the nonce file must exist before `cargo test` or `cargo clippy` can build the crate.

### Development build (incremental, no bundling)

```bash
npm run dev
```

Starts the Next.js dev server on **port 9002** only — it does not launch the Tauri window. This is sufficient for working on the web frontend in isolation.

To also open the desktop window, run the following in a **separate terminal**:

```bash
npm run dev:tauri
# or directly:
cargo tauri dev
```

`tauri dev` reads `build.devUrl: "http://localhost:9002"` from `tauri.conf.json`, connects to the running dev server, and hot-reloads both the Rust layer (on save) and the Next.js frontend (via Next.js HMR).

### Iterative Rust + frontend development

1. Terminal 1: `npm run dev` — keeps the Next.js HMR server running on port 9002.
2. Terminal 2: `cargo tauri dev` — opens the desktop window, watching Rust and frontend files for changes.

The Rust dev experience is standard Cargo: `cargo build` in `src-tauri/` rebuilds incrementally, and `cargo test` runs the Rust test suite (including the single-instance regression guard for issue #1441).

## Debugging Rust

### Unit tests

```bash
cd src-tauri
cargo test
```

### With a debugger (Linux: lldb, Windows: Visual Studio, macOS: lldb)

```bash
# Debug build
cargo build
# Then attach debugger to the binary at:
#   target/debug/planar_nexus
```

Or run under `lldb` directly:

```bash
cargo build
lldb target/debug/planar_nexus
```

### Logging

`src-tauri/src/lib.rs` registers `tauri_plugin_log` with two profiles:

- **Debug**: `Info` level, stdout + webview console targets.
- **Release**: `Warn+` level, file target at `<app-data>/logs/planar-nexus.log`.

A panic hook (issue #1727) writes crash records to `<app-data>/crashes/panic-<unix-seconds>.log` before the process exits.

### rust-analyzer (IDE support)

The workspace root is the repo root. Point your editor's Rust analyzer at `src-tauri/Cargo.toml` and it will discover the workspace automatically.

## Tauri Plugin Registration

**Issue #1441: `tauri-plugin-single-instance` must be the FIRST plugin registered.**

The plugin intercepts a second `app.run()` invocation and focuses the first instance instead of racing two processes against the same on-disk IndexedDB / app-data directory. A Rust regression test (`single_instance_plugin_registered_before_window_owning_plugins`) parses `src-tauri/src/lib.rs` at test time and asserts this ordering.

The current plugin registration order in `lib.rs`:

1. `tauri_plugin_single_instance::init` (must be first)
2. `tauri_plugin_window_state::Builder`
3. `tauri_plugin_log`
4. `tauri_plugin_updater`

If you add a new plugin that owns the main window, it must appear **after** `single_instance`.

## CSP and `REMOTE_IMAGE_HOSTS` Synchronisation

**Issue #1273: `REMOTE_IMAGE_HOSTS` in `next.config.ts` (sourced from `src/lib/security/csp-allowlist.ts`) must stay in sync with `src-tauri/tauri.conf.json` CSP `img-src`.**

The single source of truth is `src/lib/security/csp-allowlist.ts`, which exports:

- `REMOTE_IMAGE_HOSTS` — consumed by `next.config.ts` `images.remotePatterns` and the Tauri CSP `img-src`.
- `REMOTE_CONNECT_HOSTS` — consumed by the Tauri CSP `connect-src`.
- `REMOTE_FONT_HOSTS` — consumed by the Tauri CSP `font-src`.
- `TAURI_CSP` — assembled from the above and embedded directly in `tauri.conf.json`.
- `buildWebCsp()` — derived CSP for the plain-web deployment.

The `csp-audit` regression test (`tests/csp-audit.test.ts`) asserts that the `img-src`, `font-src`, and `connect-src` directives in `TAURI_CSP` match the `remotePatterns` in `next.config.ts`. When adding a new external host:

1. Add it to the appropriate array in `src/lib/security/csp-allowlist.ts`.
2. Run `npm run build` to regenerate `.next/`.
3. Run the `csp-audit` test to confirm the two configs agree.
4. The `tauri-updater-config` CI job also asserts the same synchronisation.

The `prebuild:tauri` script (`scripts/inject-tauri-csp-nonce.ts`) adds a per-build nonce to the CSP before bundling. This nonce is also exposed to the frontend at runtime via the `get_csp_nonce` Tauri command registered in `lib.rs`, so dynamically-created inline scripts can carry the correct nonce.

## Common Gotchas

### Issue #1441 — Single-instance enforcement

Two processes racing to open the same IndexedDB database causes data corruption. `tauri-plugin-single_instance` must be the first plugin in `lib.rs`. A regression test enforces this automatically.

### Issue #1273 — CSP / image-host drift

If card images fail to load in the desktop build but work in the browser, the `remotePatterns` in `next.config.ts` have likely drifted from the `img-src` directive in `tauri.conf.json`. Run the `csp-audit` test to confirm.

### `frontendDist` must exist before Rust compiles

`tauri::generate_context!()` in `lib.rs` embeds `../.next` at compile time. `cargo clippy`, `cargo test`, and `cargo build --release` all fail if `.next/` does not exist. Always run `npm run build` before Rust-only CI jobs.

### CSP nonce injection only in release builds

`scripts/inject-tauri-csp-nonce.ts` is called by `npm run prebuild:tauri` (which runs as part of `npm run build:tauri`). It is **not** run during `tauri dev`. The nonce is not required in dev mode.

### Linux: WebKit runtime dependencies

The Linux build requires several system libraries. Install them before building:

```bash
sudo apt-get install -y \
  libwebkit2gtk-4.1-dev \
  libappindicator3-dev \
  librsvg2-dev \
  libgtk-3-dev \
  libjavascriptcoregtk-4.1-dev \
  libsoup-3.0-dev \
  libxdo-dev \
  libssl-dev \
  pkg-config \
  libx11-dev \
  libxrandr-dev \
  libxi-dev \
  libxcursor-dev
```

## CI / Release

The `rust-checks` CI job runs `cargo fmt --check`, `cargo clippy --all-targets -- -D warnings`, and `cargo test` on every PR. The `cargo-audit` job runs `cargo audit` with a high/critical severity gate.

`npm run build:tauri` is the only sanctioned Tauri build command. Do not run `tauri build` directly in CI — use the npm script so the prebuild nonce injection runs first.
