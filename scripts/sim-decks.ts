/**
 * Deck lookup for the manamind self-play scripts (manamind#87, #96).
 *
 * `red` / `mono-red-aggro` and `green` / `mono-green-landfall` load the
 * #2614 main decks from scripts/data/decks/2614-decks.json (the matchup the
 * Forge and Expert yardsticks measure). Any other name is a
 * `trainingDeck()` archetype (`aggro`, `midrange`, `control`: the
 * simulator's vanilla-creature decks).
 */
import { readFileSync } from "node:fs";
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
};

const ARCHETYPES = new Set(["aggro", "midrange", "control"]);

let data: DeckFile | null = null;

function deck2614(key: string): ScryfallCard[] {
  data ??= JSON.parse(
    readFileSync(join(__dirname, "data/decks/2614-decks.json"), "utf-8"),
  ) as DeckFile;
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

/** The deck named `name`: a #2614 deck or a simulator archetype. */
export function simDeck(name: string): ScryfallCard[] {
  const key = ALIASES[name];
  if (key) return deck2614(key);
  if (!ARCHETYPES.has(name)) throw new Error(`Unknown deck ${name}`);
  return trainingDeck(name as SimDeckArchetype);
}
