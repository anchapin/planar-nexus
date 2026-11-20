/**
 * Source-scan guard for the memoized leaves rendered by
 * `src/app/(app)/game/[id]/GameBoardContent.tsx` (issue #2929).
 *
 * Background: the dialog leaves extracted from `GameBoardContent` (the
 * "slices" of issue #2418) are wrapped in `React.memo`, so every prop
 * must be referentially stable for the `memo` to actually bail out.
 * Issue #2929 was the last violation of that rule: the *spell*
 * `ModeChoiceDialog` was handed `onClose={() => setSpellModeChoice(null)}`,
 * a fresh arrow on every render, which defeated the leaf's `memo` (its
 * siblings — `XCostDialog`, `KickerDialog`, `AttractionDialog` — already
 * used the stable `useCallback` handlers created in slice 9).
 *
 * This guard fails when a memoized leaf in the board's JSX tree receives
 * an inline arrow function, an inline array literal, an inline object
 * literal, or an inline `.map()`/`.filter()` array construction.
 *
 * Scope notes:
 *   - The memoized leaf set is *derived* from the leaf sources in
 *     `src/app/(app)/game/[id]/_components/` (`export const X = memo(`),
 *     so the guard does not hard-code a component list.
 *   - `HandSizeDiscardDialog` (in `src/components/choice-dialog.tsx`) used
 *     to be a plain function component and was therefore a documented
 *     exception: its inline `choices.map(...)` prop was out of scope.
 *     Issue #2940 memoized the dialog, so it is now guarded like every
 *     other memoized leaf — at BOTH call sites (the single-player board
 *     and the legacy `/game-board` route).
 *
 * Style: mirrors the other repo-level source-scan guards under `tests/`
 * (e.g. `tests/test-count-docs-guard.test.ts`, `tests/jest-mock-boundary-guard.test.ts`).
 */

import * as fs from "fs";
import * as path from "path";

const REPO_ROOT = path.resolve(__dirname, "..");
const BOARD_PATH = path.join(
  REPO_ROOT,
  "src",
  "app",
  "(app)",
  "game",
  "[id]",
  "GameBoardContent.tsx",
);
const LEAF_DIR = path.join(
  REPO_ROOT,
  "src",
  "app",
  "(app)",
  "game",
  "[id]",
  "_components",
);
/** The legacy board route — the second `HandSizeDiscardDialog` call site. */
const LEGACY_BOARD_PATH = path.join(
  REPO_ROOT,
  "src",
  "app",
  "(app)",
  "game-board",
  "page.tsx",
);
/** The module that owns the memoized `HandSizeDiscardDialog` (#2940). */
const CHOICE_DIALOG_PATH = path.join(
  REPO_ROOT,
  "src",
  "components",
  "choice-dialog.tsx",
);

/**
 * Memoized components that live outside the leaf directory. `HandSizeDiscardDialog`
 * was memoized in issue #2940, so its props must be referentially stable
 * exactly like every other memoized leaf.
 */
const EXTRA_MEMOIZED_LEAVES = ["HandSizeDiscardDialog"];

interface Violation {
  component: string;
  prop: string;
  kind: string;
  expression: string;
}

/**
 * The memoized leaves rendered by the board: every component exported
 * from the leaf directory as `export const X = memo(...)`.
 */
function memoizedLeafNames(): string[] {
  const names = new Set<string>();
  for (const file of fs.readdirSync(LEAF_DIR)) {
    if (!file.endsWith(".tsx")) continue;
    const source = fs.readFileSync(path.join(LEAF_DIR, file), "utf-8");
    const re = /export\s+const\s+([A-Z][A-Za-z0-9_]*)\s*=\s*memo\(/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(source)) !== null) {
      names.add(m[1]);
    }
  }
  return [...names].sort();
}

/** Read the raw attribute text of the JSX tag starting at `start`. */
function readTagAttributes(source: string, start: number): string {
  let i = start;
  let depth = 0;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i++;
      continue;
    }
    if (c === "{" || c === "(" || c === "[") {
      depth++;
      i++;
      continue;
    }
    if (c === "}" || c === ")" || c === "]") {
      depth--;
      i++;
      continue;
    }
    if (depth === 0 && (c === ">" || (c === "/" && source[i + 1] === ">"))) break;
    i++;
  }
  return source.slice(start, i);
}

/** Read a `{...}` expression, returning the inner text. */
function readBraced(source: string, openIndex: number): string {
  let i = openIndex + 1;
  let depth = 1;
  let quote: string | null = null;
  while (i < source.length) {
    const c = source[i];
    if (quote) {
      if (c === "\\") {
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      quote = c;
      i++;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) break;
    }
    i++;
  }
  return source.slice(openIndex + 1, i);
}

interface PropValue {
  prop: string;
  value: string;
}

/** Extract every `{expression}` prop of a JSX tag. */
function propValues(attributes: string): PropValue[] {
  const out: PropValue[] = [];
  const re = /([A-Za-z_$][A-Za-z0-9_$]*)\s*=\{/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(attributes)) !== null) {
    const openIndex = m.index + m[0].length - 1;
    const value = readBraced(attributes, openIndex).trim();
    out.push({ prop: m[1], value });
    re.lastIndex = openIndex + 1 + value.length + 2;
  }
  return out;
}

/** Classify an inline prop expression, or return null when it is stable. */
function classify(value: string): string | null {
  // Array construction is checked first: an inline `choices.map((c) => ...)`
  // also contains an arrow, but the array is the actual memo defeat.
  if (/\.(map|filter)\(/.test(value)) return "inline array construction";
  if (value.includes("=>")) return "inline arrow function";
  if (value.startsWith("[")) return "inline array literal";
  if (/^\{\s*[A-Za-z_$][A-Za-z0-9_$]*\s*:/.test(value)) {
    return "inline object literal";
  }
  return null;
}

/**
 * Scan a source file for memoized leaves that receive an unstable prop.
 *
 * @param source the JSX source to scan
 * @param leaves the memoized component names to watch
 */
function findUnstableProps(source: string, leaves: string[]): Violation[] {
  const leafSet = new Set(leaves);
  const violations: Violation[] = [];
  const re = /<([A-Z][A-Za-z0-9_]*)\b/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const name = m[1];
    if (!leafSet.has(name)) continue;
    const attributes = readTagAttributes(source, m.index + m[0].length);
    for (const { prop, value } of propValues(attributes)) {
      const kind = classify(value);
      if (kind) {
        violations.push({
          component: name,
          prop,
          kind,
          expression: value.replace(/\s+/g, " ").slice(0, 120),
        });
      }
    }
  }
  return violations;
}

describe("GameBoardContent memoized-leaf prop guard (#2929)", () => {
  const boardSource = fs.readFileSync(BOARD_PATH, "utf-8");
  const legacyBoardSource = fs.readFileSync(LEGACY_BOARD_PATH, "utf-8");
  const choiceDialogSource = fs.readFileSync(CHOICE_DIALOG_PATH, "utf-8");
  const leaves = memoizedLeafNames();

  it("derives the memoized leaf set from the leaf sources", () => {
    // Sanity: the derivation must find the dialog leaves.
    expect(leaves).toEqual(
      expect.arrayContaining([
        "ModeChoiceDialog",
        "XCostDialog",
        "KickerDialog",
        "AttractionDialog",
        "MulliganDialog",
        "GameHeader",
        "GameFooter",
      ]),
    );
    // `HandSizeDiscardDialog` lives outside the leaf directory; it is
    // watched explicitly (see EXTRA_MEMOIZED_LEAVES) because it is
    // memoized since issue #2940.
    expect(leaves).not.toContain("HandSizeDiscardDialog");
  });

  it("memoizes HandSizeDiscardDialog (#2940)", () => {
    // The dialog is only safe to memoize once its props are stable; the
    // source scan below pins that it really is a memoized component.
    expect(choiceDialogSource).toContain(
      "export const HandSizeDiscardDialog = React.memo(",
    );
  });

  it("passes no memoized leaf an inline arrow / array / object prop", () => {
    const violations = findUnstableProps(boardSource, [
      ...leaves,
      ...EXTRA_MEMOIZED_LEAVES,
    ]);
    expect(violations).toEqual([]);
  });

  it("passes no memoized leaf an inline prop at the legacy board call site", () => {
    // The legacy `/game-board` route renders the same memoized dialog; it
    // must not hand it an inline `choices.map(...)` or an inline
    // `onConfirm` arrow either (#2940).
    const violations = findUnstableProps(
      legacyBoardSource,
      EXTRA_MEMOIZED_LEAVES,
    );
    expect(violations).toEqual([]);
  });

  it("keeps the spell ModeChoiceDialog on a stable useCallback handler", () => {
    expect(boardSource).toContain("const handleSpellModeClose = useCallback(");
    expect(boardSource).toContain("onClose={handleSpellModeClose}");
    expect(boardSource).not.toContain("onClose={() => setSpellModeChoice(null)}");
  });

  it("flags the pre-fix spell ModeChoiceDialog inline onClose (#2929)", () => {
    // The pre-fix tree: the spell ModeChoiceDialog received a fresh arrow
    // on every render, which defeated the leaf's `memo`.
    const preFix = boardSource.replace(
      "onClose={handleSpellModeClose}",
      "onClose={() => setSpellModeChoice(null)}",
    );
    expect(preFix).not.toBe(boardSource);

    const violations = findUnstableProps(preFix, leaves);
    expect(violations).toEqual([
      {
        component: "ModeChoiceDialog",
        prop: "onClose",
        kind: "inline arrow function",
        expression: "() => setSpellModeChoice(null)",
      },
    ]);
  });

  it("flags inline array and object literal props on a memoized leaf", () => {
    const snippet = `
      <ModeChoiceDialog
        isOpen={!!spellModeChoice}
        onClose={handleSpellModeClose}
        modes={[1, 2, 3]}
        selectionMode="single"
        onSelectIndex={handleModeSelect}
      />;
      <XCostDialog options={{ max: 5 }} onClose={handleXCostClose} />;
    `;
    const violations = findUnstableProps(snippet, leaves);
    expect(violations.map((v) => `${v.component}.${v.prop}: ${v.kind}`)).toEqual([
      "ModeChoiceDialog.modes: inline array literal",
      "XCostDialog.options: inline object literal",
    ]);
  });

  it("flags an inline .map() card list on HandSizeDiscardDialog (#2940)", () => {
    // The pre-fix tree handed the dialog a fresh `choices.map(...)` array on
    // every render, which re-ran the dialog's reset effect and silently
    // cleared the player's selection.
    const snippet = `
      <HandSizeDiscardDialog
        open
        title={humanDiscardChoice.type === "discard_cards" ? "Discard" : undefined}
        prompt={humanDiscardChoice.prompt}
        count={humanDiscardChoice.minChoices}
        cards={humanDiscardChoice.choices.map((c) => ({
          id: String(c.value),
          name: c.label,
        }))}
        onConfirm={handleHandSizeDiscard}
      />;
    `;
    const violations = findUnstableProps(snippet, EXTRA_MEMOIZED_LEAVES);
    expect(violations.map((v) => `${v.component}.${v.prop}: ${v.kind}`)).toEqual([
      "HandSizeDiscardDialog.cards: inline array construction",
    ]);
  });

  it("flags an inline onConfirm arrow on HandSizeDiscardDialog (#2940)", () => {
    const snippet = `
      <HandSizeDiscardDialog
        open
        prompt={waitingChoice.prompt}
        count={waitingChoice.minChoices}
        cards={handSizeDiscardCards}
        onConfirm={(cardIds) => {
          resolveWaitingChoice(cardIds);
        }}
      />;
    `;
    const violations = findUnstableProps(snippet, EXTRA_MEMOIZED_LEAVES);
    expect(violations.map((v) => `${v.component}.${v.prop}: ${v.kind}`)).toEqual([
      "HandSizeDiscardDialog.onConfirm: inline arrow function",
    ]);
  });

  it("keeps both call sites on the memoized card list (#2940)", () => {
    // Both call sites must derive the card list with `useMemo` and hand the
    // dialog the stable identifier.
    expect(boardSource).toContain("const handSizeDiscardCards = useMemo(");
    expect(boardSource).toContain("cards={handSizeDiscardCards}");
    expect(legacyBoardSource).toContain(
      "const handSizeDiscardCards = React.useMemo(",
    );
    expect(legacyBoardSource).toContain("cards={handSizeDiscardCards}");
    expect(legacyBoardSource).toContain("onConfirm={handleHandSizeDiscard}");
  });
});
