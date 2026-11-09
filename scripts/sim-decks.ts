/**
 * Deck lookup for the manamind self-play scripts (manamind#87, #96).
 *
 * `red` / `mono-red-aggro` and `green` / `mono-green-landfall` load the
 * #2614 main decks from scripts/data/decks/2614-decks.json (the matchup the
 * Forge and Expert yardsticks measure). The Track 2 candidate decks
 * (manamind#96: `white`, `blue-tempo`, `black`, `green-ramp`,
 * `blue-control`) load from scripts/data/decks/track2-candidate-decks.json.
 * Deck names resolve across every JSON file in scripts/data/decks, with the
 * 2614 file taking precedence on a name collision. Any other name is a
 * `trainingDeck()` archetype (`aggro`, `midrange`, `control`: the
 * simulator's vanilla-creature decks).
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { ScryfallCard } from "@/app/actions";
import type { SimDeckArchetype } from "@/ai/simulation/game-simulator";
import { trainingDeck } from "@/ai/simulation/training-session";

interface DeckFile {
  decks: Record<string, { main: Record<string, number> }>;
  cards: Record<string, ScryfallCard>;
}

const BASIC_MANA: Record<string, string> = {
  Plains: "W",
  Island: "U",
  Swamp: "B",
  Mountain: "R",
  Forest: "G",
};

const ALIASES: Record<string, string> = {
  red: "mono-red-aggro",
  "mono-red-aggro": "mono-red-aggro",
  green: "mono-green-landfall",
  "mono-green-landfall": "mono-green-landfall",
  white: "mono-white-aggro",
  "mono-white-aggro": "mono-white-aggro",
  "blue-tempo": "mono-blue-tempo",
  "mono-blue-tempo": "mono-blue-tempo",
  black: "mono-black-aggro",
  "mono-black-aggro": "mono-black-aggro",
  "green-ramp": "mono-green-ramp",
  "mono-green-ramp": "mono-green-ramp",
  "blue-control": "mono-blue-control",
  "mono-blue-control": "mono-blue-control",
};

const ARCHETYPES = new Set(["aggro", "midrange", "control"]);

let files: Map<string, DeckFile> | null = null;

/** Every deck file in scripts/data/decks, basename to parsed file. */
function deckFiles(): Map<string, DeckFile> {
  files ??= new Map(
    readdirSync(join(__dirname, "data/decks"))
      .filter((f) => f.endsWith(".json"))
      .map(
        (f) =>
          [
            f,
            JSON.parse(
              readFileSync(join(__dirname, "data/decks", f), "utf-8"),
            ) as DeckFile,
          ] as const,
      ),
  );
  return files;
}

/** The deck named `key` from any deck file, the 2614 file first. */
function deckCards(key: string): ScryfallCard[] | null {
  const entries = [...deckFiles().entries()];
  entries.sort(([a], [b]) =>
    a === "2614-decks.json" ? -1 : b === "2614-decks.json" ? 1 : 0,
  );
  const data = entries.find(([, f]) => key in f.decks)?.[1];
  if (!data) return null;
  const cards: ScryfallCard[] = [];
  for (const [name, count] of Object.entries(data.decks[key].main)) {
    const card = data.cards[name];
    const basic = BASIC_MANA[name];
    // Basics carry no oracle text; give them their mana ability, as
    // trainingDeck() does for the simulator decks.
    const c =
      basic && !card.oracle_text
        ? { ...card, oracle_text: `({T}: Add {${basic}}.)` }
        : card;
    for (let i = 0; i < count; i++) cards.push(c);
  }
  return cards;
}

/** The deck named `name`: a deck-file deck or a simulator archetype. */
export function simDeck(name: string): ScryfallCard[] {
  const key = ALIASES[name];
  if (key) {
    const cards = deckCards(key);
    if (!cards) throw new Error(`Unknown deck ${name}`);
    return cards;
  }
  if (!ARCHETYPES.has(name)) throw new Error(`Unknown deck ${name}`);
  return trainingDeck(name as SimDeckArchetype);
}
