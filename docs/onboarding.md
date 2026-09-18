# Planar Nexus — Onboarding

> **TL;DR for new contributors.** Install Node 22, run `npm ci`, then `npm run dev` on port `9002`. The rules engine is `src/lib/game-state/`. Tests live next to the source. Read [`AGENTS.md`](../AGENTS.md) first, [`CLAUDE.md`](../CLAUDE.md) second, and [`docs/TESTING.md`](TESTING.md) before opening any test PR.

---

## What is Planar Nexus

Planar Nexus is a digital Magic: The Gathering tabletop built as a single Next.js 16 + React 19 web app wrapped in a Tauri 2 desktop shell (`src-tauri/`). It pairs a deck builder, an AI deck coach (Genkit flows over the Vercel AI SDK with a heuristic fallback that needs no API key), an AI opponent you can play against in the browser, and direct-peer WebRTC P2P multiplayer for real-table feel — all backed by a custom MTG rules engine in `src/lib/game-state/` whose only public surface is its barrel.

## Setup

```bash
git clone https://github.com/anchapin/planar-nexus.git
cd planar-nexus
cp .env.example .env          # AI keys are optional; heuristic fallback works without them
npm ci                        # Node 22 + npm ci (lockfile-pinned)
npm run dev                   # Next dev server on http://localhost:9002
```

Open `http://localhost:9002`. The desktop build is `npm run build:tauri`; you do **not** need Tauri tools to contribute to web-only or engine work.

## Project layout

Top-level directories a first-time contributor needs to recognize:

- `src/app/` — Next.js App Router (`(app)/` route group for protected pages, `api/` for route handlers: `ai-proxy`, `chat`, `deck-import`, `signaling`).
- `src/lib/` — shared client libraries, including `card-database.ts`, `ai-client.ts`, `indexeddb-storage.ts`, and the engine barrel.
- `src/lib/game-state/` — the MTG rules engine. Its **only public API is the barrel** (`src/lib/game-state/index.ts`); deep imports outside this tree are blocked by ESLint (#1710) and are the only place Stryker mutation scoring is enforced.
- `src/ai/` — Genkit flows (`deck-coach-review`, `opponent-generation`) and AI simulation tests.
- `src-tauri/` — Rust desktop shell (`tauri-plugin-single-instance` must stay registered FIRST in `lib.rs`, enforced by a Rust regression test #1441).
- `tests/` — cross-module integration tests; unit tests are co-located under `__tests__/` directories next to the source they cover.
- `scripts/` — Node/TS check + ratchet scripts that gate CI (`check-broken-links.mjs`, `check-coverage-docs-sync.mjs`, `ratchet-coverage.js`, …).
- `docs/` — canonical contributor docs (this file, `TESTING.md`, `API.md`, `AI_PROVIDER_SETUP.md`, `PERSISTENCE_ARCHITECTURE.md`, …).
- `.github/` — workflows and the `setup-node-npm-ci` composite action every CI job must use (#1762).

## Current test count

Source of truth: `npx jest --listTests | wc -l` for the suite count, and `npm test --silent | grep -E "^(Tests:|Test Suites:)"` for the per-suite case totals. The block below is rewritten by `scripts/ratchet-test-count.mjs` and verified in CI by `scripts/check-test-count-docs.mjs` (issue #1902). A drift beyond this block fails merge.

<!-- TEST_COUNT:START -->

**Test suites:** 539
**Test cases:** 11203 (11189 passed + 14 skipped)
**Snapshots:** 3
<!-- TEST_COUNT:END -->

If the numbers above do not match the latest `npm test` run on `main`, a contributor should run `npm run ratchet:test-count` locally to refresh the block and open a follow-up PR — the CI gate otherwise blocks the next merge.

## Where to start

- [`AGENTS.md`](../AGENTS.md) — the agent-facing quick reference (commands, architecture, testing quirks, Tauri gotchas). Read first.
- [`CLAUDE.md`](../CLAUDE.md) — broader architecture notes. Largely current; trust code over `CLAUDE.md` where they differ.
- [`docs/TESTING.md`](TESTING.md) — canonical testing guide (root `TESTING.md` redirects here). Coverage floors, mutation floors, Playwright, video-derived fixtures.
- [`docs/API.md`](API.md) — AI proxy and HTTP API reference.
- `src/lib/game-state/index.ts` — the rules-engine barrel. Importing any deeper path is an ESLint error #1710; the barrel is the entire public contract for engine consumers.

When you finish a change, run `npm run typecheck && npm run lint && npm test` locally before pushing — `pre-commit` runs `eslint --fix` → `tsc --noEmit` → `prettier --write` on staged files, and the `build` job in `.github/workflows/ci.yml` is gated by `test`, `lint`, `typecheck`, and every named guard job (broken-links, coverage-docs, mutation-docs, e2e-asserts, jest-mock-boundary, no-prompt-in-engine, turn-credentials, …).

Welcome aboard.
