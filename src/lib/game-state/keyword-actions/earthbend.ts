/**
 * Earthbend N (#2614 Ba Sing Se, Earthbender Ascension): "Target land you
 * control becomes a 0/0 creature with haste that's still a land. Put N +1/+1
 * counters on it. When it dies or is exiled, return it to the battlefield
 * tapped."
 *
 * Simplification: the return happens on the next state-based-action pass
 * instead of as a triggered ability on the stack.
 */
import type { CardInstanceId, GameState } from "../types";
import { addCounters } from "../card-instance";
import { moveCardToZone } from "./removal";

/** The zone a card is in, trusting `currentZoneKey` only when it's current. */
function zoneKeyOf(state: GameState, cardId: CardInstanceId): string {
  const cached = state.cards.get(cardId)?.currentZoneKey;
  if (cached && state.zones.get(cached)?.cardIds.includes(cardId)) {
    return cached;
  }
  for (const [key, zone] of state.zones) {
    if (zone.cardIds.includes(cardId)) return key;
  }
  return "";
}

export function earthbend(
  state: GameState,
  cardId: CardInstanceId,
  amount: number,
): GameState {
  const card = state.cards.get(cardId);
  if (!card || !zoneKeyOf(state, cardId).endsWith("-battlefield")) return state;
  const printed = card.earthbent?.cardData ?? card.cardData;
  if (!/\bLand\b/.test(printed.type_line ?? "")) return state;
  const [types, subtypes] = (printed.type_line ?? "").split(/\s+[\u2014-]\s+/);
  const typeLine = /\bCreature\b/.test(types ?? "")
    ? (printed.type_line ?? "")
    : `${types} Creature${subtypes ? ` \u2014 ${subtypes}` : ""}`;
  const cards = new Map(state.cards);
  cards.set(
    cardId,
    addCounters(
      {
        ...card,
        cardData: {
          ...printed,
          type_line: typeLine,
          power: "0",
          toughness: "0",
        },
        earthbent: { cardData: printed },
      },
      "+1/+1",
      amount,
    ),
  );
  return { ...state, cards };
}

/**
 * An earthbent land that died or was exiled returns to the battlefield
 * tapped under its owner's control, as a new object with its printed
 * characteristics (CR 400.7). One that went anywhere else just loses the
 * earthbend. Returns the same state when nothing changed.
 */
export function returnEarthbentLands(state: GameState): GameState {
  let s = state;
  for (const [id, card] of state.cards) {
    if (!card.earthbent) continue;
    const zone = zoneKeyOf(s, id);
    if (zone.endsWith("-battlefield")) continue;
    const restored = {
      ...card,
      cardData: card.earthbent.cardData,
      controllerId: card.ownerId,
    };
    delete restored.earthbent;
    const cards = new Map(s.cards);
    cards.set(id, restored);
    s = { ...s, cards };
    if (!zone.endsWith("-graveyard") && !zone.endsWith("-exile")) continue;
    const r = moveCardToZone(s, id, "battlefield");
    if (!r.success) continue;
    const moved = r.state.cards.get(id);
    if (!moved) {
      s = r.state;
      continue;
    }
    const after = new Map(r.state.cards);
    after.set(id, { ...moved, isTapped: true });
    s = { ...r.state, cards: after };
  }
  return s;
}
