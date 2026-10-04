import type { CardScript } from "./schema";
import { RAW_CARD_SCRIPTS } from "./cards/index.generated";

let byName: Map<string, CardScript> | null = null;

export function normalizeCardName(name: string): string {
  return name.trim().toLowerCase();
}

function build(): Map<string, CardScript> {
  const map = new Map<string, CardScript>();
  // No zod parse here: it would ship zod in the game page bundle (#1814).
  // Every script file is validated against CardScriptSchema by the
  // card-scripts test suite, so a malformed file fails CI instead.
  for (const script of RAW_CARD_SCRIPTS as readonly CardScript[]) {
    map.set(normalizeCardName(script.name), script);
  }
  return map;
}

/** The script for a card, or undefined when the card has none yet. */
export function getCardScript(name: string | undefined): CardScript | undefined {
  if (!name) return undefined;
  byName ??= build();
  return byName.get(normalizeCardName(name));
}

/** Every scripted card name, for coverage reporting. */
export function listScriptedCardNames(): string[] {
  byName ??= build();
  return [...byName.values()].map((s) => s.name).sort();
}
