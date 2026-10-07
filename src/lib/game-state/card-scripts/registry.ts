import type { CardScript } from "./schema";

/**
 * Card scripts load in their own chunk (#1814, #2491): the generated index
 * grows with every scripted card, so it must not ship in a page's first load.
 * Pages that run games await `loadCardScripts()` before building game state;
 * tests register the index synchronously from jest.setup.js.
 */
let byName: Map<string, CardScript> | null = null;
let loading: Promise<void> | null = null;

export function normalizeCardName(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Install the script index. No zod parse here: it would ship zod in the game
 * page bundle (#1814). Every script file is validated against
 * CardScriptSchema by the card-scripts test suite, so a malformed file fails
 * CI instead.
 */
export function registerCardScripts(raw: readonly unknown[]): void {
  const map = new Map<string, CardScript>();
  for (const script of raw as readonly CardScript[]) {
    map.set(normalizeCardName(script.name), script);
  }
  byName = map;
}

/** Whether the script index has been installed. */
export function cardScriptsLoaded(): boolean {
  return byName !== null;
}

/** Fetch and install the script index once; later calls share the load. */
export function loadCardScripts(): Promise<void> {
  if (byName) return Promise.resolve();
  loading ??= import("./cards/index.generated")
    .then((m) => registerCardScripts(m.RAW_CARD_SCRIPTS))
    .catch((err: unknown) => {
      loading = null;
      throw err;
    });
  return loading;
}

/**
 * The script for a card, or undefined when the card has none yet. Before the
 * index is loaded every card reads as unscripted, so this also starts the
 * load; game pages await `loadCardScripts()` first so that never happens
 * mid-game.
 */
export function getCardScript(
  name: string | undefined,
): CardScript | undefined {
  if (!name) return undefined;
  if (!byName) {
    // Start the load once. Attaching a fresh handler on every lookup piled
    // up pending promises when a synchronous caller (a headless training
    // run) never yielded to let the import finish (#2612).
    if (!loading) void loadCardScripts().catch(() => undefined);
    return undefined;
  }
  return byName.get(normalizeCardName(name));
}

/** Every scripted card name, for coverage reporting. */
export function listScriptedCardNames(): string[] {
  return [...(byName?.values() ?? [])].map((s) => s.name).sort();
}

/** Test hook: forget the installed index. */
export function resetCardScriptsForTests(): void {
  byName = null;
  loading = null;
}
