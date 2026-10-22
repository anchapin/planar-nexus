/**
 * Shared fixtures and builders for the card-scripts test suite.
 *
 * Extracted from the former monolithic `card-scripts.test.ts` (issue #2642).
 * Every per-op test file imports its builders from here so the fixtures are
 * defined exactly once and cannot drift between files.
 */
import { join } from "node:path";
import { createCardInstance } from "../../card-instance";
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  ScryfallCard,
  StackObject,
  Target,
} from "../../types";

export const CARDS_DIR = join(__dirname, "..", "cards");

export const id = (s: string) => s as CardInstanceId;

/** Minimal mock ScryfallCard for tests that need a card definition. */
export function card(name: string, typeLine: string, pt?: [number, number]) {
  return {
    id: `mock-${name}`,
    name,
    type_line: typeLine,
    oracle_text: "",
    mana_cost: "",
    cmc: 0,
    colors: [],
    color_identity: [],
    keywords: [],
    legalities: { standard: "legal" },
    layout: "normal",
    power: pt ? String(pt[0]) : undefined,
    toughness: pt ? String(pt[1]) : undefined,
  } as unknown as ScryfallCard;
}

/** Put a card instance into a player's zone, returning the updated state. */
export function put(
  state: GameState,
  playerId: PlayerId,
  cardId: string,
  data: ScryfallCard,
  zone: "battlefield" | "library" | "hand" | "graveyard" = "battlefield",
): GameState {
  const key = `${playerId}-${zone}`;
  const cards = new Map(state.cards);
  cards.set(
    id(cardId),
    createCardInstance(data, playerId, playerId, {
      id: id(cardId),
      currentZoneKey: key,
    }),
  );
  const zones = new Map(state.zones);
  const z = zones.get(key)!;
  zones.set(key, { ...z, cardIds: [...z.cardIds, id(cardId)] });
  return { ...state, cards, zones };
}

/** Minimal stack object with the given controller and targets. */
export function spell(
  controllerId: PlayerId,
  targets: Target[] = [],
): Pick<StackObject, "controllerId" | "sourceCardId" | "targets"> {
  return { controllerId, sourceCardId: null as never, targets };
}

export const cardTarget = (cardId: string): Target => ({
  type: "card",
  targetId: cardId,
  isValid: true,
});

export const playerTarget = (playerId: string): Target => ({
  type: "player",
  targetId: playerId,
  isValid: true,
});

/** Card ids currently on a player's battlefield. */
export const battlefield = (s: GameState, p: PlayerId) =>
  s.zones.get(`${p}-battlefield`)?.cardIds ?? [];
