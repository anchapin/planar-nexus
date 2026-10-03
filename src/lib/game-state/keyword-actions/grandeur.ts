/**
 * Grandeur ability word (issue #2300): Page, Loose Leaf.
 *
 * "Grandeur \u2014 Discard another card named Page, Loose Leaf: Reveal cards
 * from the top of your library until you reveal an instant or sorcery card.
 * Put that card into your hand and the rest on the bottom of your library in
 * a random order."
 *
 * The cost names the card itself, so it can only be paid with a second copy
 * in hand (CR 207.2c: ability words have no rules meaning of their own). The
 * parser records it as a `discard-named:<name>` additional cost; this module
 * checks and pays it, and resolves the reveal-until effect.
 */
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
} from "../types";

export const DISCARD_NAMED_PREFIX = "discard-named:";

const DISCARD_NAMED_COST = /\bdiscard another card named (.+)$/i;

const REVEAL_UNTIL_INSTANT_OR_SORCERY =
  /\breveal cards from the top of your library until you reveal an instant or sorcery card\b/i;

/** Name required by a "discard another card named X" cost, if any. */
export function parseDiscardNamedCost(costText: string): string | null {
  const cleaned = costText.replace(/^\s*grandeur\s*[\u2014-]\s*/i, "").trim();
  const match = cleaned.match(DISCARD_NAMED_COST);
  return match ? match[1].trim() : null;
}

/** The named-discard requirement on an ability's additional costs, if any. */
export function getDiscardNamedCost(
  additionalCosts: readonly string[] | undefined,
): string | null {
  const entry = additionalCosts?.find((c) =>
    c.startsWith(DISCARD_NAMED_PREFIX),
  );
  return entry ? entry.slice(DISCARD_NAMED_PREFIX.length) : null;
}

export function hasGrandeur(card: Pick<CardInstance, "cardData">): boolean {
  const text = card.cardData.oracle_text ?? "";
  return /\bgrandeur\s*[\u2014-]\s*discard another card named\b/i.test(text);
}

/**
 * Another card in the player's hand with the given name, excluding
 * `excludeId` (the source itself never sits in hand, but stay defensive).
 */
export function findNamedCardInHand(
  state: GameState,
  playerId: PlayerId,
  name: string,
  excludeId?: CardInstanceId,
): CardInstanceId | null {
  const hand = state.zones.get(`${playerId}-hand`);
  if (!hand) return null;
  const wanted = name.toLowerCase();
  for (const id of hand.cardIds) {
    if (id === excludeId) continue;
    const card = state.cards.get(id);
    if (card && (card.cardData.name ?? "").toLowerCase() === wanted) return id;
  }
  return null;
}

export function isRevealUntilInstantOrSorceryText(text: string): boolean {
  return REVEAL_UNTIL_INSTANT_OR_SORCERY.test(text);
}

function isInstantOrSorcery(card: CardInstance | undefined): boolean {
  const typeLine = card?.cardData.type_line ?? "";
  return /\b(Instant|Sorcery)\b/.test(typeLine);
}

function shuffle<T>(items: T[], random: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Reveal from the top of the library until an instant or sorcery. That card
 * goes to hand; every other revealed card goes to the bottom in a random
 * order. With no hit, the whole library is revealed and reordered. The top of
 * the library is the end of `cardIds` (see drawCard), the bottom the start.
 */
export function revealUntilInstantOrSorcery(
  state: GameState,
  playerId: PlayerId,
  random: () => number = Math.random,
): { state: GameState; foundCardId: CardInstanceId | null; revealed: number } {
  const libraryKey = `${playerId}-library`;
  const handKey = `${playerId}-hand`;
  const library = state.zones.get(libraryKey);
  const hand = state.zones.get(handKey);
  if (!library || !hand || library.cardIds.length === 0) {
    return { state, foundCardId: null, revealed: 0 };
  }

  const remaining = [...library.cardIds];
  const revealed: CardInstanceId[] = [];
  let found: CardInstanceId | null = null;
  while (remaining.length > 0) {
    const id = remaining.pop() as CardInstanceId;
    if (isInstantOrSorcery(state.cards.get(id))) {
      found = id;
      break;
    }
    revealed.push(id);
  }

  const zones = new Map(state.zones);
  zones.set(libraryKey, {
    ...library,
    cardIds: [...shuffle(revealed, random), ...remaining],
  });
  if (found) {
    zones.set(handKey, { ...hand, cardIds: [...hand.cardIds, found] });
  }
  return {
    state: { ...state, zones, lastModifiedAt: Date.now() },
    foundCardId: found,
    revealed: revealed.length + (found ? 1 : 0),
  };
}
