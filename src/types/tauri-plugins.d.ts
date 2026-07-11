/**
 * Ambient type stubs for the two Tauri plugins dynamically imported by
 * `src/lib/updater.ts`:
 *
 *   - `@tauri-apps/plugin-updater`  -> `check()`, `Update` (lines 148, 200)
 *   - `@tauri-apps/plugin-process`  -> `relaunch()`           (line 212)
 *
 * Why this file exists
 * --------------------
 * Both packages are declared in `package.json` and are present in CI's
 * `node_modules/` (installed via `npm ci`). However, a local working tree
 * whose `node_modules/` predates their addition (e.g. an environment that ran
 * `npm install` before the deps were listed) will be missing them, and
 * `tsc --noEmit` fails with TS2307:
 *
 *   src/lib/updater.ts(148,38): error TS2307: Cannot find module
 *     '@tauri-apps/plugin-updater' or its corresponding type declarations.
 *
 * That blocks the husky pre-commit hook (`lint-staged` -> `tsc --noEmit`),
 * which forces every commit in the repo to use `--no-verify`, silently
 * skipping prettier and eslint pre-commit checks too. During the
 * 2026-07-10/11 wave-orchestration batch this caused all 9 merged PRs to
 * bypass the hook.
 *
 * Why ambient `declare module` is the right tool
 * ----------------------------------------------
 * An ambient module declaration is consulted by TypeScript only when the
 * module cannot be resolved to a physical file in `node_modules`. The
 * declared surface mirrors EXACTLY what `src/lib/updater.ts` consumes:
 *
 *   plugin-updater: `check()` plus `Update.version | .body | .date |
 *                   .downloadAndInstall()`
 *   plugin-process: `relaunch()`
 *
 * Effect on resolution
 * --------------------
 * When the real packages ARE installed, the real bundled `.d.ts`
 * (`plugin-updater/dist-js/index.d.ts`, where `Update` is a `declare class`)
 * is resolved for the named `Update` export. The ambient `interface Update`
 * here is merged into that view; because `updater.ts` only touches members
 * that exist in BOTH declarations (`version`, `body`, `date`,
 * `downloadAndInstall`), the merge is structurally compatible and `tsc`
 * passes in both configurations:
 *   - packages present  -> real types used (CI / fresh `npm ci`)
 *   - packages absent   -> this stub used  (stale local `node_modules/`)
 *
 * Verified via `tsc --noEmit` in both states; see issue #1480.
 *
 * @see https://github.com/anchapin/planar-nexus/issues/1480
 */

declare module "@tauri-apps/plugin-updater" {
  export interface Update {
    version: string;
    body?: string;
    date?: string;
    downloadAndInstall(): Promise<void>;
  }
  export function check(): Promise<Update | null>;
}

declare module "@tauri-apps/plugin-process" {
  export function relaunch(): Promise<void>;
}
