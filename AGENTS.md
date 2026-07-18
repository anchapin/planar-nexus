# Planar Nexus — Agent Guide

Digital Magic: The Gathering tabletop: deck builder, AI deck coach, AI opponent, and P2P multiplayer. Next.js 16 (App Router) + React 19 web app, wrapped in a Tauri 2 desktop shell (`src-tauri/`). All source under `src/`.

## Commands

Package manager is **npm** (`package-lock.json` + CI `npm ci`, Node 22). No `pnpm-lock.yaml` / `yarn.lock` — do not introduce another package manager.

- `npm run dev` — dev server on **port 9002** (not 3000). Playwright boots the same port.
- `npm run typecheck` — `tsc --noEmit`. Run before lint/test.
- `npm run lint` — `eslint src --max-warnings 1000` (warnings do NOT fail; only errors gate).
- `npm test` — Jest. One file: `npm test -- --testPathPattern=layer-system`. One test by name: `--testNamePattern="..."`.
- `npm run test:coverage` then `npm run test:coverage:ratchet` — coverage floor auto-bumps; see Testing below.
- `npm run test:e2e` — Playwright (boots dev server automatically). Cross-browser: chromium / firefox / webkit.
- `npm run test:e2e:flake` — `tsx e2e/flake-detector.ts`; 5 runs, fails at threshold 4 flaky.
- `npm run mutate:<module>` — Stryker on one rules module. Modules: `layer-system`, `replacement-effects`, `spell-casting`, `trigger-system`, `state-based-actions`. Avoid full `npm run test:mutation` (~40 min).
- `npm run a11y:contrast` — color-contrast gate enforced in CI (`:report` variant regenerates `docs/CONTRAST_AUDIT.md`).
- `npm run simulate` — runs only the AI simulation suite (`src/ai/__tests__/simulation/`).
- Desktop: `npm run build:tauri` (= `tauri build`, runs `npm run build` first).

## Pre-commit & commits (enforced by husky)

- Config in `lint-staged.config.cjs`. `pre-commit` runs lint-staged: for `*.{ts,tsx}` it runs `eslint --fix` → `tsc --noEmit` → `prettier --write`. A staged `.ts`/`.tsx` file that fails typecheck **blocks the commit**.
- `commit-msg` runs commitlint (`@commitlint/config-conventional`). Header **lower-case**, **min 10 chars**. Allowed types only: `feat fix docs style refactor test chore revert`.

## CI gate (`.github/workflows/ci.yml`)

The `build` job `needs:` **all** of: `test, lint, typecheck, commitlint, mutation-test, security, cargo-audit, a11y-contrast, e2e, workflow-lint, tauri-updater-config`. Failing any one blocks merge. Run `typecheck && lint && test` locally before pushing.

- `mutation-test` runs **only** `mutate:layer-system` per PR (the full 5-module allowlist runs nightly in `.github/workflows/mutation.yml`).
- `workflow-lint` enforces that every job bootstraps via the shared `.github/actions/setup-node-npm-ci` composite (Node 22 + `npm ci`, ≥11 uses repo-wide). It **rejects** direct `npm ci` and `actions/setup-node@v1-5`. When adding/editing a workflow, reuse that action — do not hand-roll setup.

## Architecture (not obvious from filenames)

- **App Router**: `src/app/(app)/` is a route group of protected routes sharing a layout (`dashboard`, `deck-builder`, `deck-coach`, `single-player`, `multiplayer`). `src/app/api/` holds route handlers: `ai-proxy`, `chat`, `deck-import`, `signaling`.
- **`src/app/actions.ts` is misnamed**: it exports _client-side_ wrappers around AI flows (no `"use server"`), not Next.js server actions.
- **Rules engine** lives in `src/lib/game-state/` — a large MTG rules implementation (layer-system, replacement-effects, trigger-system, state-based-actions, spell-casting, combat, mana, …). This is the correctness-critical core and the only place mutation testing runs.
- **AI**: multi-provider via Vercel AI SDK (`@ai-sdk/openai|anthropic|google|react`) with a unified proxy route at `src/app/api/ai-proxy/`; Genkit flows in `src/ai/flows/` (deck-coach-review, opponent-generation). Provider keys in `.env` (`OPENAI_* / ANTHROPIC_* / GOOGLE_* / ZAI_*`). Deck coaching has a heuristic fallback that needs **no** API key.
- **Persistence**: IndexedDB via Dexie (`dexie-react-hooks`); tests use `fake-indexeddb`.
- **Card search**: full-text via `@orama/orama`; card data sourced from Scryfall.
- **Multiplayer**: PeerJS (WebRTC) + the signaling API route; TURN relay via `NEXT_PUBLIC_TURN_*` env.
- **UI**: shadcn/ui (`components.json`; aliases `@/components`, `@/lib/utils`, `@/components/ui`) + Tailwind v4 + lucide-react icons. Merge classes with `cn()` from `@/lib/utils`.
- Path alias `@/*` → `src/*` (mirrors `tsconfig.json` and `jest.config.js`).

## Testing quirks (hard-won)

- Jest env is `jsdom` with `ts-jest`. **`@orama/*` is mapped to its CommonJS dist in `jest.config.js` `moduleNameMapper`** — do not remove; the ESM build breaks the jsdom resolver.
- **Coverage thresholds are enforced in CI and ratcheted.** `jest.config.js` `coverageThreshold.global` is rewritten upward by `scripts/ratchet-coverage.js` (`npm run test:coverage:ratchet`). Never hand-raise a threshold above _measured_ coverage or CI fails; re-measure first. Target is 70%.
- **`scripts/qa-coverage-gate.js`** fails CI if any `it.todo` remains in `src/lib/game-state/__tests__/qa-coverage-holes.test.ts` (rows GS-RT-1..13 must have real tests).
- Tests are co-located in `__tests__/` dirs; cross-module integration tests live in repo-root `tests/` (discovered via `jest.config.js` roots).
- **Video-derived fixtures**: `scripts/generate-test-fixture.ts` turns `src/lib/__fixtures__/video-derived/` JSON into Jest tests. Edits under `src/lib/game-state/**` or `__fixtures__/**` trigger the `video-derived-tests` workflow.
- **Playwright** auto-sets `planar-nexus:onboarded=true` in localStorage to suppress the onboarding-tour backdrop (it would intercept pointer events). `e2e/onboarding.spec.ts` clears it via `forceFreshVisitor()`.
- API mocking uses **MSW** (`src/test-utils/msw/`); DOM assertions via React Testing Library (`jest.setup.js`).

## Tauri / desktop gotchas

- `tauri build` runs `npm run build` (`beforeBuildCommand`) and serves `../.next`. Dev uses `devUrl` `localhost:9002`.
- **`tauri-plugin-single-instance` must be the FIRST plugin registered** in `src-tauri/src/lib.rs` (issue #1441); a Rust regression test enforces this.
- **`REMOTE_IMAGE_HOSTS` in `next.config.ts` (sourced from `src/lib/security/csp-allowlist.ts`) must stay in sync with `src-tauri/tauri.conf.json` CSP `img-src`** — the `csp-audit` test asserts they match (issue #1273).
- Rust: edition 2021, MSRV 1.77.2. `cargo audit` runs in CI (local mirror: `scripts/`). Updater + single-instance plugins are desktop-only.

## Environment

Copy `.env.example` → `.env`. AI keys are optional (heuristic fallback works). `NEXT_PUBLIC_TURN_*` recommended for production P2P. See `docs/API.md` for AI config.

## Canonical docs (read these, don't guess)

- `docs/TESTING.md` — canonical testing guide (root `TESTING.md` redirects there).
- `CLAUDE.md` — broader architecture notes. Largely current (correctly states Next.js 16 and `src/lib/game-state/`), but still carries a few stale claims (e.g. the "Firebase App Hosting via `apphosting.yaml`" line conflicts with `docs/FIREBASE_REMOVAL_VERIFICATION.md`). Trust code over `CLAUDE.md` where they differ.
