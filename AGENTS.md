# Planar Nexus — Agent Guide

Digital Magic: The Gathering tabletop: deck builder, AI deck coach, AI opponent, and P2P multiplayer. Next.js 16 (App Router) + React 19 web app, wrapped in a Tauri 2 desktop shell (`src-tauri/`). All source under `src/`.

## Commands

Package manager is **npm** (`package-lock.json` + CI `npm ci`, Node 22). Ignore `pnpm-lock.yaml` — it is stale; npm is authoritative.

- `npm run dev` — dev server on **port 9002** (not 3000). Playwright boots the same port.
- `npm run typecheck` — `tsc --noEmit`. Run before lint/test.
- `npm run lint` — `eslint src --max-warnings 1000` (warnings do NOT fail; only errors gate).
- `npm test` — Jest. One file: `npm test -- --testPathPattern=layer-system`. One test by name: `--testNamePattern="..."`.
- `npm run test:coverage` then `npm run test:coverage:ratchet` — coverage floor auto-bumps; see Testing below.
- `npm run test:e2e` — Playwright (boots dev server automatically).
- `npm run mutate:<module>` — Stryker on one rules module (e.g. `mutate:layer-system`). Avoid full `npm run test:mutation` unless you have ~40 min.
- `npm run a11y:contrast` — color-contrast gate enforced in CI.
- `npm run simulate` — runs only the AI simulation suite (`src/ai/__tests__/simulation/`).
- Desktop: `npm run build:tauri` (= `tauri build`, runs `npm run build` first).

## Pre-commit & commits (enforced by husky)

- `pre-commit`: `lint-staged` runs eslint --fix + `tsc --noEmit` + prettier on staged files. A staged file that fails typecheck **blocks the commit**.
- `commit-msg`: commitlint, conventional commits only. Header **lowercase**, **min 10 chars**. Allowed types only: `feat fix docs style refactor test chore revert`.

## CI gate (`.github/workflows/ci.yml`)

A PR's build job waits on **all** of: test, lint, typecheck, commitlint, mutation-test (scoped), security audit, cargo-audit, a11y-contrast, e2e, workflow-lint. Failing any one blocks merge. Run `typecheck && lint && test` locally before pushing.

## Architecture (not obvious from filenames)

- **App Router**: `src/app/(app)/` is a route group of protected routes sharing a layout (`dashboard`, `deck-builder`, `deck-coach`, `single-player`, `multiplayer`). `src/app/api/` holds route handlers: `ai-proxy`, `chat`, `deck-import`, `signaling`.
- **`src/app/actions.ts` is misnamed**: it exports _client-side_ wrappers around AI flows, not Next.js server actions.
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
- **Playwright** auto-sets `planar-nexus:onboarded=true` in localStorage to suppress the onboarding-tour backdrop (it would intercept pointer events). `e2e/onboarding.spec.ts` clears it via `forceFreshVisitor()`. Cross-browser: chromium / firefox / webkit.
- API mocking uses **MSW** (`src/test-utils/msw/`); DOM assertions via React Testing Library (`jest.setup.js`).

## Tauri / desktop gotchas

- `tauri build` runs `npm run build` (`beforeBuildCommand`) and serves `../.next`. Dev uses `devUrl` `localhost:9002`.
- **`tauri-plugin-single-instance` must be the FIRST plugin registered** in `src-tauri/src/lib.rs` (issue #1441); a Rust regression test enforces this.
- **Keep `next.config.ts` image hosts (`REMOTE_IMAGE_HOSTS`) in sync with `src-tauri/tauri.conf.json` CSP `img-src`** — the `csp-audit` test asserts they match (issue #1273).
- Rust: edition 2021, MSRV 1.77.2. `cargo audit` runs in CI (local mirror: `scripts/`). Updater + single-instance plugins are desktop-only.

## Environment

Copy `.env.example` → `.env`. AI keys are optional (heuristic fallback works). `NEXT_PUBLIC_TURN_*` recommended for production P2P. See `docs/API.md` for AI config.

## Canonical docs (read these, don't guess)

- `docs/TESTING.md` — canonical testing guide (root `TESTING.md` redirects there).
- `CLAUDE.md` — broader architecture notes, but **partly stale**: it says "Next.js 15" and references a "non-existent `./game-state`" file. Actual is Next 16 and `src/lib/game-state/` is a large, live module. Trust code over `CLAUDE.md` where they differ.

---

# context-mode — MANDATORY routing rules

You have context-mode MCP tools available. These rules are NOT optional — they protect your context window from flooding. A single unrouted command can dump 56 KB into context and waste the entire session.

## Think in Code — MANDATORY

When you need to analyze, count, filter, compare, search, parse, transform, or process data: **write code** that does the work via `context-mode_ctx_execute(language, code)` and `console.log()` only the answer. Do NOT read raw data into context to process mentally. Your role is to PROGRAM the analysis, not to COMPUTE it. Write robust, pure JavaScript — no npm dependencies, only Node.js built-ins (`fs`, `path`, `child_process`). Always use `try/catch`, handle `null`/`undefined`, and ensure compatibility with both Node.js and Bun. One script replaces ten tool calls and saves 100x context.

## BLOCKED commands — do NOT attempt these

### curl / wget — BLOCKED

Any shell command containing `curl` or `wget` will be intercepted and blocked by the context-mode plugin. Do NOT retry.
Instead use:

- `context-mode_ctx_fetch_and_index(url, source)` to fetch and index web pages
- `context-mode_ctx_execute(language: "javascript", code: "const r = await fetch(...)")` to run HTTP calls in sandbox

### Inline HTTP — BLOCKED

Any shell command containing `fetch('http`, `requests.get(`, `requests.post(`, `http.get(`, or `http.request(` will be intercepted and blocked. Do NOT retry with shell.
Instead use:

- `context-mode_ctx_execute(language, code)` to run HTTP calls in sandbox — only stdout enters context

### Direct web fetching — BLOCKED

Do NOT use any direct URL fetching tool. Use the sandbox equivalent.
Instead use:

- `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` to query the indexed content

## REDIRECTED tools — use sandbox equivalents

### Shell (>20 lines output)

Shell is ONLY for: `git`, `mkdir`, `rm`, `mv`, `cd`, `ls`, `npm install`, `pip install`, and other short-output commands.
For everything else, use:

- `context-mode_ctx_batch_execute(commands, queries)` — run multiple commands + search in ONE call
- `context-mode_ctx_execute(language: "shell", code: "...")` — run in sandbox, only stdout enters context

### File reading (for analysis)

If you are reading a file to **edit** it → reading is correct (edit needs content in context).
If you are reading to **analyze, explore, or summarize** → use `context-mode_ctx_execute_file(path, language, code)` instead. Only your printed summary enters context.

### grep / search (large results)

Search results can flood context. Use `context-mode_ctx_execute(language: "shell", code: "grep ...")` to run searches in sandbox. Only your printed summary enters context.

## Tool selection hierarchy

1. **GATHER**: `context-mode_ctx_batch_execute(commands, queries)` — Primary tool. Runs all commands, auto-indexes output, returns search results. ONE call replaces 30+ individual calls. Each command: `{label: "descriptive header", command: "..."}`. Label becomes FTS5 chunk title — descriptive labels improve search.
2. **FOLLOW-UP**: `context-mode_ctx_search(queries: ["q1", "q2", ...])` — Query indexed content. Pass ALL questions as array in ONE call.
3. **PROCESSING**: `context-mode_ctx_execute(language, code)` | `context-mode_ctx_execute_file(path, language, code)` — Sandbox execution. Only stdout enters context.
4. **WEB**: `context-mode_ctx_fetch_and_index(url, source)` then `context-mode_ctx_search(queries)` — Fetch, chunk, index, query. Raw HTML never enters context.
5. **INDEX**: `context-mode_ctx_index(content, source)` — Store content in FTS5 knowledge base for later search.

## Output constraints

- Keep responses under 500 words.
- Write artifacts (code, configs, PRDs) to FILES — never return them as inline text. Return only: file path + 1-line description.
- When indexing content, use descriptive source labels so others can `search(source: "label")` later.

## ctx commands

| Command       | Action                                                                                |
| ------------- | ------------------------------------------------------------------------------------- |
| `ctx stats`   | Call the `stats` MCP tool and display the full output verbatim                        |
| `ctx doctor`  | Call the `doctor` MCP tool, run the returned shell command, display as checklist      |
| `ctx upgrade` | Call the `upgrade` MCP tool, run the returned shell command, display as checklist     |
| `ctx purge`   | Call the `purge` MCP tool with confirm: true. Warns before wiping the knowledge base. |

After /clear or /compact: knowledge base and session stats are preserved. Use `ctx purge` if you want to start fresh.
