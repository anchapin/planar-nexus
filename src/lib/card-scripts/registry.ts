import { CardScriptSchema, type CardScript } from "./schema";
import { RAW_CARD_SCRIPTS } from "./cards/index.generated";

let byName: Map<string, CardScript> | null = null;

export function normalizeCardName(name: string): string {
  return name.trim().toLowerCase();
}

function build(): Map<string, CardScript> {
  const map = new Map<string, CardScript>();
  for (const raw of RAW_CARD_SCRIPTS) {
    // Scripts are validated by the card-scripts test suite; parse again here
    // so a malformed file can never reach the engine.
    const parsed = CardScriptSchema.safeParse(raw);
    if (!parsed.success) continue;
    map.set(normalizeCardName(parsed.data.name), parsed.data);
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
