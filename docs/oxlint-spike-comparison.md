# Oxlint spike — ESLint parity comparison (issue #2890)

**Status:** spike only — **no swap**, ESLint stays the lint gate.
**Verdict:** **KEEP ESLINT** (Oxlint is usable only as an optional report-only fast pre-pass).
**Tree / commit:** worktree `planar-nexus-worker-2890`, `HEAD = 0679afaa37f25e7ef8bb238819bf2bade4b64b7f` (origin/main), clean tree except the two files named in §8.
**Date of runs:** 2026-11-02 (local, this worktree).

> **LABEL: LOCAL.** Every number below comes from runs executed in this worktree on the commit above.
> **No CI comparison job exists** — CI wiring is a **deferred follow-up** (see §9), it is _not_ part of this
> diff and is _not_ claimed here. No workflow file under `.github/workflows/` was touched.

---

## 1. What was verified before measuring (and two contradicted premises)

Re-verified on this tree (not taken from the issue text):

| Premise in #2890                                                        | Reality on this tree                                                                                                                                                                         | Evidence                                                                                                                                       |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run lint` is `eslint src --max-warnings 1000`                      | **True**                                                                                                                                                                                     | `package.json`                                                                                                                                 |
| ESLint 10                                                               | **True** — `eslint@10.12.0` installed                                                                                                                                                        | `node_modules/eslint/package.json`                                                                                                             |
| `@typescript-eslint`, `eslint-config-next`, react + react-hooks plugins | **Partly false** — `eslint-config-next@^16.4.2` _is_ a devDependency but is **not referenced by `eslint.config.mjs`**. There are therefore **zero Next.js rules active** in this repo today. | `grep -rn "eslint-config-next" eslint.config.mjs eslint/` → no hits; `npx eslint --print-config src/app/page.tsx` contains no `@nextjs/*` rule |
| lint-staged = `eslint --fix` → `tsc --noEmit` → `prettier --write`      | **Incomplete** — there is a 3rd step: `jest --findRelatedTests <staged src files>`                                                                                                           | `lint-staged.config.cjs`                                                                                                                       |
| repo custom rules exist                                                 | **True** — 1 custom plugin rule + `no-restricted-imports` pattern blocks + `no-restricted-syntax` selector                                                                                   | `eslint/rules/*`, `eslint.config.mjs`                                                                                                          |

`eslint-config-next` being installed-but-unwired is a **contradiction of the issue premise**: any parity claim
about "Next.js rules" is moot — there are none to compare against.

### 1.1 ESLint rule families actually in play

From `npx eslint --print-config src/app/page.tsx` (general file) and `src/ai/flows/ai-deck-coach-review.ts`
(AI flow) / `src/lib/game-state/engine.ts` (engine), cross-checked by reading `eslint.config.mjs` and
`eslint/rules/`:

| Family                                                             | Rules active | Examples / repo-specific configuration                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------ | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ESLint core (`js.configs.recommended` + repo block)                | 52           | `no-empty`, `no-console` (warn, allow warn/error/info), `no-restricted-syntax` (**repo-custom selector**: ban `fetch(` → "Use safeFetch or AI proxy client"), `no-useless-assignment`, `preserve-caught-error` (both warn, new in `@eslint/js` v10)                                                                                                                        |
| `@typescript-eslint` (recommended)                                 | 21           | `no-unused-vars` (warn, `argsIgnorePattern: "^_"`), `no-explicit-any` (warn), `no-empty-function` (warn)                                                                                                                                                                                                                                                                   |
| `react`                                                            | 1            | `react/no-danger` (error) — `dangerouslySetInnerHTML` banned except `src/components/ui/chart.tsx`                                                                                                                                                                                                                                                                          |
| `react-hooks`                                                      | 2            | `rules-of-hooks` (error), `exhaustive-deps` (warn)                                                                                                                                                                                                                                                                                                                         |
| **repo-custom import/guard conventions** (`no-restricted-imports`) | 4 blocks     | (a) `src/**` barrel rule — regex ban on `@/lib/game-state/<sub>` except `lite`/`lite-validation`; (b) relative `./game-state/<sub>` and `../game-state/<sub>` bans; (c) `vitest` path ban; (d) **engine boundary** (`src/lib/game-state/**`): path bans `@/lib/game-rules`, `@/lib/card-database` + regex bans on every other `@/…` alias and on depth-aware `../` escapes |
| **repo-custom plugin** `@planar-nexus/ai-security`                 | 1            | `ai-flow-security-preamble` (error) on `src/ai/flows/**` — every prompt builder must prepend `SECURITY_PREAMBLE` (issue #2151). Implementation: `eslint/rules/ai-flow-security-preamble.mjs` (+ legacy `require-security-preamble.cjs`)                                                                                                                                    |

Total for a generic `src/` file: **76 active rules** of 98 present in the resolved config.

**Current gate state:** ESLint reports **0 errors / 597 warnings** on `src/` (cap is `--max-warnings 1000`),
so _nothing in the repo currently fails the ESLint gate_. The error-severity rules that exist
(`no-restricted-imports` regex patterns, `no-restricted-syntax`, `react/no-danger`,
`react-hooks/rules-of-hooks`, `ai-flow-security-preamble`) are all currently satisfied.

---

## 2. How Oxlint was run

Per the task, the **npx route was tried first** and it worked, so **no `oxlint` devDependency was added and
`package-lock.json` was not touched** (`git status` shows `package.json` only).

```
npx -y oxlint@1.88.0 --version        ->  Version: 1.88.0
```

The added script (the only manifest change):

```json
"lint:oxlint": "npx -y oxlint@1.88.0 src"
```

It is pinned to `1.88.0` (the staging-studio version) so runs are reproducible; `npx` caches the tarball, so
subsequent runs are offline-capable and add ~0.4 s of npx overhead.

**Exit-code decision (explicit):** `npm run lint:oxlint` is **report-only and non-blocking**. With Oxlint's
default configuration every diagnostic on this tree is a _warning_ (`Found 862 warnings and 0 errors`), and
Oxlint exits **0** for warnings unless `--deny-warnings` is passed. Measured exit code of
`npm run lint:oxlint` on this tree: **0**. The script is **not** referenced by `npm run lint`, `prelint`,
`precommit`, husky, lint-staged or any build script, so it cannot fail the build.

---

## 3. Comparison table (LOCAL runs, same commit, same `src/` surface)

Wall-clock = median of 3 consecutive runs each, measured with `date +%s%3N` around the exact command line.

| Linter                          | Command (verbatim)                                                                                           | Runs (ms)             | Median                  | Files | Rules enabled                  | Errors | Warnings | Exit code |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------- | ----------------------- | ----- | ------------------------------ | ------ | -------- | --------- |
| **ESLint 10.12.0**              | `npx eslint src --max-warnings 1000`                                                                         | 40648 / 43965 / 42657 | **42 657 ms (≈42.7 s)** | 1743  | 76 (resolved config)           | **0**  | **597**  | 0         |
| **Oxlint 1.88.0** (default cfg) | `npx -y oxlint@1.88.0 src`                                                                                   | 1948 / 1898 / 2060    | **1948 ms (≈1.9 s)**    | 1742  | 96 (correctness category only) | **0**  | **862**  | 0         |
| **Oxlint 1.88.0** (+ plugins)   | `npx -y oxlint@1.88.0 src --react-plugin --nextjs-plugin --import-plugin --promise-plugin --jsx-a11y-plugin` | 4965 / 4084           | ≈4.5 s                  | 1742  | 188                            | 0      | 1246     | 0         |
| npm wrapper                     | `npm run lint`                                                                                               | —                     | 46 506 ms               | 1743  | 76                             | 0      | 597      | 0         |
| npm wrapper                     | `npm run lint:oxlint`                                                                                        | —                     | 2 533 ms                | 1742  | 96                             | 0      | 862      | 0         |

**Speed: Oxlint is ≈21.9× faster than ESLint on `src/` (1.9 s vs 42.7 s)** — with plugins on, ≈9.5×.

File-count delta (1 file): `src/lib/game-state/card-scripts/cards/index.generated.ts` is **git-ignored**, so
Oxlint (which honours `.gitignore` by default) skips it while ESLint lints it. It is a generated file, so this
is benign.

---

## 4. Rule-family coverage

Legend: ✅ covered & enabled by default · ⚠️ available but **off by default** (needs config/category) · ❌ **not implemented** in Oxlint 1.88.

| ESLint rule family (repo)                                                                                                                     | Oxlint counterpart                   | Status                                                                                  | Notes + file example                                                                                                                                                                                                                                   |
| --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| ESLint core (36 of the 52 active core rules enabled by default; 14 present but off by default, 2 not implemented — see rows below)            | same-named `eslint/*` rules          | ✅/⚠️/❌                                                                                | e.g. `no-async-promise-executor`, `no-fallthrough` (off by default)… counts verified by the supervisor from `oxlint --rules` against the resolved ESLint config                                                                                        |
| `@typescript-eslint` type-safety rules (`no-unsafe-function-type`, `no-wrapper-object-types`, `prefer-as-const`, `triple-slash-reference`, …) | `typescript/*`                       | ✅/⚠️                                                                                   | 12 of the 21 TS rules are on by default; the other 9 are present but off by default (counts verified by the supervisor from `oxlint --rules`)                                                                                                          |
| `@typescript-eslint/no-unused-vars`                                                                                                           | `eslint(no-unused-vars)`             | ✅ but **semantics differ**                                                             | see §5 (underscore handling, args policy)                                                                                                                                                                                                              |
| `@typescript-eslint/no-explicit-any` (72 hits)                                                                                                | `typescript(no-explicit-any)`        | ⚠️ _restriction_ category                                                               | off by default; e.g. `src/ai/ai-action-executor.ts:144`                                                                                                                                                                                                |
| `@typescript-eslint/no-empty-function` (32)                                                                                                   | `eslint(no-empty-function)`          | ⚠️ _restriction_                                                                        | e.g. `src/app/(app)/game-board/page.tsx:1170`                                                                                                                                                                                                          |
| `@typescript-eslint/no-namespace`, `no-empty-object-type`, `no-require-imports`, `ban-ts-comment`, `no-array-constructor`                     | `typescript/*` / `eslint/*`          | ⚠️ _restriction_ / _pedantic_                                                           | off by default                                                                                                                                                                                                                                         |
| `no-useless-assignment` (57)                                                                                                                  | `eslint(no-useless-assignment)`      | ⚠️ _nursery_                                                                            | off by default; e.g. `src/ai/ai-turn-loop.ts:367`                                                                                                                                                                                                      |
| `preserve-caught-error` (14)                                                                                                                  | `eslint(preserve-caught-error)`      | ⚠️ _suspicious_                                                                         | off by default; e.g. `src/ai/flows/ai-deck-coach-review.ts:92`                                                                                                                                                                                         |
| `no-console` (5)                                                                                                                              | `eslint(no-console)`                 | ⚠️ _restriction_                                                                        | off by default; e.g. `src/lib/logger.ts:75`                                                                                                                                                                                                            |
| `no-restricted-syntax` — repo's `fetch(` ban (15)                                                                                             | —                                    | ❌ **not implemented**                                                                  | Oxlint has **no** `no-restricted-syntax` at all (`oxlint --rules` → absent). `src/app/api/deck-import/route.ts:475`, `src/hooks/use-deck-coach-chat.ts:576`                                                                                            |
| `no-restricted-imports` — **`paths` entries** (`vitest`, `@/lib/game-rules`, `@/lib/card-database`)                                           | `eslint(no-restricted-imports)`      | ⚠️ _restriction_ + config                                                               | Oxlint _does_ support `paths` with custom messages — verified on a fixture (the `vitest` ban fired)                                                                                                                                                    |
| `no-restricted-imports` — **`patterns` with `regex`** (barrel rule + engine boundary)                                                         | `eslint(no-restricted-imports)`      | ⚠️ **silently unsupported**                                                             | Oxlint 1.88 does **not** evaluate `regex` patterns — the config key is accepted without error but never fires. Verified: same fixture → ESLint **2 errors**, Oxlint **1 error** (the `paths` one only). Affects issue #1710 / #1925 / #1724 boundaries |
| `react-hooks/rules-of-hooks` (error)                                                                                                          | `react/rules-of-hooks`               | ⚠️ off by default; **needs an `.oxlintrc` with `"plugins": ["react"]` + explicit rule** | `--react-plugin` alone does **not** enable it (fixture: Oxlint 0 findings vs ESLint 2 errors). With an explicit config Oxlint catches it: `react-hooks(rules-of-hooks)` on the same fixture                                                            |
| `react-hooks/exhaustive-deps` (29)                                                                                                            | `react-hooks/exhaustive-deps)`       | ⚠️ needs `--react-plugin`                                                               | With the plugin: Oxlint 32 vs ESLint 29 — near parity, but anchors differ (hook-call line vs dependency-array line); one genuine Oxlint extra (`src/hooks/use-p2p-connection.ts:243`)                                                                  |
| `react/no-danger` (error)                                                                                                                     | `react/no-danger`                    | ⚠️ off by default; needs explicit config                                                | Verified on fixture (Oxlint 0 with `--react-plugin`, 1 error with an `.oxlintrc` enabling `react/no-danger`)                                                                                                                                           |
| `@planar-nexus/ai-security/ai-flow-security-preamble` (error, `src/ai/flows/**`)                                                              | —                                    | ❌ **cannot be expressed**                                                              | Oxlint has no custom-rule/plugin support; this repo rule (issue #2151) can only be run by ESLint. Currently 0 violations                                                                                                                               |
| Next.js rules (`@nextjs/*`)                                                                                                                   | `next/*` (plugin off by default)     | ⚪ moot                                                                                 | ESLint has **no** Next.js rules active (see §1) — nothing to preserve. Oxlint's `next/*` plugin is optional (`next(no-img-element)` 17, `next(no-html-link-for-pages)` 2 …)                                                                            |
| _(no ESLint equivalent)_                                                                                                                      | `unicorn/*` (on by default), `oxc/*` | ➕ new findings                                                                         | 71 diagnostics Oxlint reports that the repo's ESLint config has no rule for at all (§5, FP-4)                                                                                                                                                          |

**Summary of the rule families Oxlint does NOT cover:**

1. `no-restricted-syntax` (repo `fetch(` ban) — _not implemented in Oxlint at all_.
2. `no-restricted-imports` **`patterns`/`regex`** — implemented, but regex patterns are silently ignored, so the
   game-state barrel rule (#1710/#1925) and the engine-boundary rule (#1724) are uncovered.
3. The custom plugin rule `@planar-nexus/ai-security/ai-flow-security-preamble` (#2151) — uncoverable.
4. Everything that is only _off by default_ in Oxlint (`no-explicit-any`, `no-empty-function`, `no-console`,
   `preserve-caught-error`, `no-useless-assignment`, `no-case-declarations`, `prefer-const`, `no-var`,
   `no-prototype-builtins`, …) unless a new `.oxlintrc.json` is added — **the spike adds no such file**, so
   today these are uncovered in practice.
5. `react/no-danger` and `react-hooks/rules-of-hooks` need an explicit Oxlint config, not just a CLI flag.

---

## 5. False positives / false negatives (every occurrence class, with file examples)

Method: ESLint JSON output (`npx eslint src --max-warnings 1000 -f json`) and Oxlint JSON output
(`npx -y oxlint@1.88.0 src -f json`) were compared by `(file, line)`.

### FP — Oxlint reports, ESLint does not

| #                            | Kind                                                                                                                                                                 | Count                                         | Examples                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| FP-1                         | `eslint(no-unused-vars)` on **unused parameters named `_`** — ESLint's `@typescript-eslint/no-unused-vars` sets `argsIgnorePattern: "^_"`, Oxlint does not honour it | 2                                             | `src/app/(app)/spectator/_components/ai-player-view.tsx:121` (`.filter(([_, count]) => count > 0)`), `src/components/combat-declaration.tsx:540`                                                                                                                                                                                                                                                                                                                                                                                                             |
| FP-2                         | `eslint(no-unused-vars)` inside **test files** — the repo config turns the rule **off** for `**/__tests__/**` and `*.test.ts(x)`; Oxlint has no such override        | 425 of 431 Oxlint-only hits are in test files | `src/ai/__tests__/combat-decision-tree.test.ts:7`, `src/ai/__tests__/bluff-hold-logic.test.ts:8`, `src/lib/ai/__tests__/embedding-worker.test.ts:48`                                                                                                                                                                                                                                                                                                                                                                                                         |
| FP-3                         | `eslint(no-unsafe-optional-chaining)` on `as`-cast expressions — ESLint (correctly) does not treat `x?.y as T` as an unsafe chain; Oxlint does                       | 2                                             | `src/lib/__tests__/p2p-signaling-client.test.ts:530`, `src/lib/game-state/__tests__/lane75a-until-eot-chosen-target-copy.test.ts:347`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| FP-4                         | Rules the repo's ESLint config simply does not have (Oxlint enables `unicorn`/`oxc` by default) — "new finding" noise rather than a wrong finding                    | 71                                            | `unicorn(no-new-array)` 35 (`src/lib/pipeline/knowledge-extraction/knowledge-vector-store.ts:22`), `unicorn(no-useless-fallback-in-spread)` 10 (`src/lib/public-lobby-browser.ts:99`), `unicorn(no-useless-spread)` 9 (`src/lib/game-state/card-scripts/interpret.ts:3090`), `unicorn(no-unnecessary-await)` 9, `unicorn(prefer-string-starts-ends-with)` 4 (`src/lib/decklist-utils.ts:392`), `unicorn(no-useless-length-check)` 1 (`src/lib/game-state/validation-service.ts:360`), `typescript(no-useless-empty-export)` 1, `eslint(no-useless-rename)` 1 |
| FP-5 (bonus, real bug class) | `oxc(erasing-op)` — dead multiplication. ESLint has no equivalent rule, so this is an Oxlint **true positive that ESLint misses**                                    | 1                                             | `src/lib/ranked-mode.ts:392` — `((rating.seasonWins + rating.seasonLosses * 0) / totalGames) * 100`                                                                                                                                                                                                                                                                                                                                                                                                                                                          |

Note on location drift: 4 of the 431 Oxlint-only `no-unused-vars` hits are the **same** variables ESLint does
report, only anchored at the declaration instead of the last assignment
(`src/ai/providers/google.ts:201` vs ESLint `:206`; `src/lib/game-state/layer-system/index.ts:868` vs `:877`;
`src/lib/game-state/spell-casting/cast.ts:112` vs `:120`; `src/lib/procedural-art-generator.ts:91` vs `:112`).
They are not extra findings.

### FN — ESLint reports, Oxlint does not

| #     | Kind                                                                                                                                                                      | Count                                                                                                                                              | Examples                                                                                                                                                                                                                         |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FN-1  | `@typescript-eslint/no-unused-vars` on **underscore-prefixed variables** — ESLint only ignores `^_` for _args_ (`argsIgnorePattern`), Oxlint ignores it for every binding | 11                                                                                                                                                 | `src/ai/worker/ai-turn-worker-state.ts:54,55,56`, `src/app/(app)/draft/page.tsx:109,110,140`, `src/lib/game-state/engine-worker-state.ts:46,47,48`, `src/lib/saved-games.ts:219`, `src/test-utils/__mocks__/next-router.tsx:230` |
| FN-2  | `@typescript-eslint/no-explicit-any`                                                                                                                                      | 72                                                                                                                                                 | `src/ai/ai-action-executor.ts:144`, `src/ai/flows/context-builder.ts:89,107`, `src/ai/stack-interaction-ai.ts:3034`                                                                                                              |
| FN-3  | `no-useless-assignment`                                                                                                                                                   | 57                                                                                                                                                 | `src/ai/ai-turn-loop.ts:367`, `src/ai/decision-making/combat-decision-tree.ts:912,914`                                                                                                                                           |
| FN-4  | `@typescript-eslint/no-empty-function`                                                                                                                                    | 32                                                                                                                                                 | `src/app/(app)/game-board/page.tsx:1170,1222`, `src/app/(app)/multiplayer/host/page.tsx:267`                                                                                                                                     |
| FN-5  | `react-hooks/exhaustive-deps` (partially — only with `--react-plugin`)                                                                                                    | 29                                                                                                                                                 | `src/app/(app)/card-studio/page.tsx:72`, `src/app/(app)/deck-builder/_components/deck-stats-panel.tsx:136,146,151`                                                                                                               |
| FN-6  | `no-restricted-syntax` (repo `fetch(` ban) — **rule does not exist in Oxlint**                                                                                            | 15                                                                                                                                                 | `src/app/(app)/deck-builder/_components/import-export-controls.tsx:193`, `src/app/api/ai-proxy/validate/route.ts:180`, `src/app/api/deck-import/route.ts:475`, `src/hooks/use-deck-coach-chat.ts:576`                            |
| FN-7  | `preserve-caught-error`                                                                                                                                                   | 14                                                                                                                                                 | `src/ai/flows/ai-deck-coach-review.ts:92`, `src/ai/flows/ai-gameplay-assistance.ts:417`, `src/ai/flows/ai-opponent-deck-generation.ts:299,327`                                                                                   |
| FN-8  | `no-console`                                                                                                                                                              | 5                                                                                                                                                  | `src/components/meta/AntiMetaRecommendations.tsx:268`, `src/components/trigger-dialog.tsx:585,604`, `src/lib/logger.ts:75`                                                                                                       |
| FN-9  | `no-restricted-imports` **regex patterns** (barrel + engine boundary)                                                                                                     | 0 hits today (repo is compliant) but the _rule capability_ is missing — a future deep import would **not** be caught by Oxlint                     | fixture proof in §4                                                                                                                                                                                                              |
| FN-10 | `@planar-nexus/ai-security/ai-flow-security-preamble`                                                                                                                     | 0 hits today (repo is compliant) but the capability is missing — a future AI flow that drops `SECURITY_PREAMBLE` would **not** be caught by Oxlint | `eslint/rules/ai-flow-security-preamble.mjs`                                                                                                                                                                                     |
| FN-11 | ESLint's own `Unused eslint-disable directive` reporting (19 warnings, `reportUnusedDisableDirectives: 1`)                                                                | 19                                                                                                                                                 | `src/ai/flows/__tests__/verify-citations.test.ts:205,271`, `src/lib/__tests__/atomic-local-storage.test.ts:44,46,50,242,244,248,297,299,303`                                                                                     |

Also worth noting: Oxlint's `react-hooks/exhaustive-deps` (with `--react-plugin`) reports **one** issue ESLint
does not: `src/hooks/use-p2p-connection.ts:243` ("The ref's value `.current` is accessed directly in the effect
cleanup function"). Anchors otherwise differ by a few lines between the two implementations.

---

## 6. Autofix parity (what lint-staged's `eslint --fix` relies on)

`lint-staged.config.cjs` runs, for staged `*.{ts,tsx}`:
`eslint --fix --no-warn-ignored` → `tsc --noEmit` → `jest --findRelatedTests …` → `prettier --write --ignore-unknown`.

**What ESLint's `--fix` actually does on this tree today**
`npx eslint src --fix-dry-run -f json` → **578** messages instead of 597: the **19 unused-`eslint-disable`-directive
warnings are removed by the fixer**. Every other diagnostic carries **no `fix` payload** (only `suggestions`), i.e.
today `eslint --fix` in lint-staged does exactly two things: (a) delete stale `eslint-disable` comments,
(b) apply the handful of classic fixes (`prefer-const`, `no-useless-escape`, …) where a violation exists —
`prefer-const` currently has 0 violations, so (b) is a no-op on `src/` today.

**Fixture comparison** (fixtures were created under `scripts/.tmp-oxlint-fixture/`, run on **copies**, and
deleted afterwards — `git status` proves the tree was never modified):

| Fix                                           | `eslint --fix`            | `oxlint --fix` (default)                                                               | `oxlint --fix -D style`                                                                                                                        |
| --------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `let x = 1` → `const x = 1` (`prefer-const`)  | ✅ applied                | ❌ **not applied** (`prefer-const` is _style_, off by default)                         | ✅ applied                                                                                                                                     |
| delete unused `// eslint-disable-next-line …` | ✅ applied (19 in `src/`) | ❌ **not applied** — reported only with `--report-unused-disable-directives`, no fixer | ❌ not applied                                                                                                                                 |
| remove unused import (`no-unused-vars`)       | ❌ (suggestion only)      | ❌ (suggestion only)                                                                   | ❌                                                                                                                                             |
| side effect of `-D style`                     | —                         | —                                                                                      | ⚠️ **also** merged two `const` declarations into one comma-separated `const` (Oxlint's `one-var` style rule) — a rewrite ESLint never performs |

**Conclusion on autofix parity: parity does NOT hold.** Oxlint's default configuration fixes _nothing_ that
lint-staged's `eslint --fix` currently relies on; turning on the style category to recover `prefer-const` also
introduces rewrites ESLint does not make. If lint-staged were ever switched to `oxlint --fix`, the
stale-`eslint-disable`-directive cleanup (the only fix currently in use) would be **lost**, and the
`eslint-disable` comments in the tree would keep accumulating. lint-staged could keep working _unchanged_
**only** if `eslint --fix` is retained alongside Oxlint.

---

## 7. Recommendation

### **KEEP ESLINT** as the lint gate. Do **not** adopt Oxlint as a replacement in this repo.

Rationale, in order of weight:

1. **There is nothing to speed up.** The ESLint gate currently reports **0 errors**; warnings do not fail the
   build (`--max-warnings 1000`, actual 597). Oxlint's 22× speed-up buys nothing on a gate that never trips.
2. **The error-level rules are exactly the ones Oxlint lacks.** The repo's hard guarantees are the import
   boundary family (`no-restricted-imports` regex patterns for #1710/#1925/#1724), the `fetch(` ban
   (`no-restricted-syntax`, not implemented in Oxlint), `react/no-danger`, `react-hooks/rules-of-hooks`, and the
   custom `ai-flow-security-preamble` plugin rule (#2151). Oxlint covers **none** of them without a new
   `.oxlintrc.json`, and two of them (`no-restricted-syntax`, the custom plugin) **cannot** be covered at all.
3. **False positives are structural, not incidental.** Oxlint has no equivalent of the repo's per-directory rule
   overrides (test files) and of `argsIgnorePattern: "^_"`; on this tree that is already **427** false-positive
   diagnostics that would have to be silenced with an ignore file.
4. **Autofix parity is absent** (§6) — swapping would regress the pre-commit pipeline.

**What _is_ worth taking from this spike (optional, non-blocking):** run `npm run lint:oxlint` as a
**report-only fast pre-pass** in local development (1.9 s vs 42.7 s) to surface correctness-class findings
early — it already found one genuine dead-code issue ESLint misses (`src/lib/ranked-mode.ts:392`,
`oxc(erasing-op)`). Keep it out of `npm run lint`, out of lint-staged/husky and out of CI until a follow-up
decides otherwise.

**Named rule gap (if a future issue wants to revisit this):** the blocker list is
`no-restricted-syntax` (unimplementable), `@planar-nexus/ai-security/ai-flow-security-preamble` (unimplementable),
`no-restricted-imports` regex patterns (unsupported by Oxlint 1.88), plus the off-by-default family
`no-explicit-any`, `no-empty-function`, `no-console`, `preserve-caught-error`, `no-useless-assignment`, and the
`react` plugin rules that need an explicit config file. **All six named gaps must be closed before any swap can
be considered.**

---

## 8. Diff / how to remove this spike

Files changed by the spike:

| File                              | Change                                                                  |
| --------------------------------- | ----------------------------------------------------------------------- |
| `package.json`                    | **+1 line**: `"lint:oxlint": "npx -y oxlint@1.88.0 src"` (nothing else) |
| `docs/oxlint-spike-comparison.md` | this report (new)                                                       |

**Not changed (deliberately):** `eslint.config.mjs`, `eslint/rules/`, `npm run lint`, `lint-staged.config.cjs`,
`.husky/*`, `.github/workflows/*` (no CI job), the typechecker (`npm run typecheck` → `tsc --noEmit`, unchanged),
`package-lock.json` (no `oxlint` devDependency was added — the npx route was reproducible), `src/**` (no source
file was modified; fixtures lived under `scripts/.tmp-oxlint-fixture/` and were deleted).

**Removal is trivial and cannot affect the lint gate:** delete the `lint:oxlint` line from `package.json` and
delete `docs/oxlint-spike-comparison.md`. No dependency, lockfile, config or CI change has to be reverted.

---

## 9. Deferred follow-ups (explicitly NOT part of this diff)

- **CI comparison job** — a workflow that runs both linters and diffs their output would be the natural next
  step, but **no CI/job definition was added or modified here** (`.github/workflows/` is untouched).
- An `.oxlintrc.json` enabling the missing rule families (and the per-directory overrides needed to kill the
  false positives) — only worth writing if the recommendation ever flips.
- Deciding where the report-only fast pre-pass should live (pre-commit vs an editor/LSP integration) — note that
  touching lint-staged/husky is **out of scope for this spike** and was not done.

---

## 10. Reproduction

```bash
npm ci                       # installs the repo's own deps (eslint 10.12.0); lockfile untouched
npm run lint                 # ESLint  → exit 0, 597 warnings, 0 errors  (~42.7 s median of 3)
npm run lint:oxlint          # Oxlint → exit 0, 862 warnings, 0 errors  (~1.9 s median of 3)
npx eslint src --max-warnings 1000 -f json          # machine-readable ESLint output
npx -y oxlint@1.88.0 src -f json                    # machine-readable Oxlint output
npx -y oxlint@1.88.0 --rules                        # full Oxlint rule catalogue (coverage matrix source)
npx eslint --print-config src/app/page.tsx          # resolved ESLint rule set
npm run typecheck             # tsc --noEmit → exit 0 (manifest edit proven harmless)
```

No Jest test was run: this spike changes no source file, and the brief forbids the full suite.
