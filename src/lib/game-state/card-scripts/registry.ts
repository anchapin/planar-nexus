import type { CardScript } from "./schema";
import type { ScryfallCard } from "../types/card-data";

/**
 * Card scripts load in their own chunk (#1814, #2491): the generated index
 * grows with every scripted card, so it must not ship in a page's first load.
 * Pages that run games await `loadCardScripts()` before building game state;
 * tests register the index synchronously from jest.setup.js.
 */
let byName: Map<string, CardScript> | null = null;
let loading: Promise<void> | null = null;

/**
 * Wave 4.8 follow-up 8 lane 75b (#2614 follow-up):
 * synchronous `cardData` registry keyed by card name.
 * The lane 75b static shape (`become_copy: { named_card:
 * { name: string }, until: "end_of_turn" }`) needs a
 * synchronous lookup at refresh time (the `applyEffect`
 * op-path is async, but `refreshScriptedStatics` is
 * synchronous — the lane can't `await`). Tests
 * `registerCardDataForTests` to install synthetic
 * `cardData` for the cards the test exercises (the
 * card-scripts index carries behavior, not printed
 * `cardData`, so a separate registry is required).
 *
 * Production: a follow-up lane hydrates this from the
 * Scryfall search index (parallel to lane 75a's "named
 * permanent" lookup path); v1 ships the registry shape
 * + the test hook.
 *
 * The map uses the same normalize-key as `byName`
 * (lowercase + trim) so the engine can consult both
 * registries with the same key.
 */
let cardDataByName: Map<string, ScryfallCard> | null = null;

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

/**
 * Wave 4.8 follow-up 8 lane 75b (#2614 follow-up):
 * install the synchronous `cardData` registry keyed by
 * card name (parallel to `registerCardScripts` for the
 * behavior-side index). Tests pass a hand-built map of
 * synthetic `cardData` for the cards the test exercises.
 *
 * Production: a follow-up lane hydrates this from the
 * Scryfall search index. The lane 75b test installs its
 * own map at setup time and resets it on teardown.
 */
export function registerCardDataForTests(
  cards: readonly ScryfallCard[],
): void {
  const map = new Map<string, ScryfallCard>();
  for (const card of cards) {
    map.set(normalizeCardName(card.name), card);
  }
  cardDataByName = map;
}

/**
 * Wave 4.8 follow-up 8 lane 75b (#2614 follow-up):
 * fetch the named card's printed `cardData` from the
 * synchronous registry. Returns `undefined` when the
 * registry isn't installed or the named card isn't
 * there. Used by `refreshScriptedStatics` for the lane
 * 75b "becomes a copy of [card name]" branch — a missing
 * named card is a no-op (the source keeps its printed
 * `cardData` and the overlay never applies). The
 * `cards/cards/*` JSON files carry behavior, not
 * `cardData`, so the engine can't look up printed stats
 * from `getCardScript` alone — a parallel registry is
 * required.
 *
 * The lookup is case-insensitive: the engine normalises
 * the requested name with `normalizeCardName`.
 */
export function getCardDataByName(name: string): ScryfallCard | undefined {
  if (!cardDataByName) return undefined;
  return cardDataByName.get(normalizeCardName(name));
}

/** Test hook: forget the `cardData` registry (lane 75b). */
export function resetCardDataForTests(): void {
  cardDataByName = null;
}
