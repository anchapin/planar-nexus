/**
 * Transform keyword action (Comprehensive Rules 701.28 / 712).
 *
 * Only a transforming double-faced card (Scryfall layout "transform") can
 * transform; an instruction to transform anything else does nothing
 * (CR 701.28c). Transforming turns the permanent to its other face. It stays
 * the same object: tapped state, counters, damage and attachments carry over
 * (CR 712.9). A transformed card that leaves the battlefield returns to its
 * front face (CR 712.14 / 712.8a).
 *
 * The engine reads `cardData.type_line`, `oracle_text`, `power` and
 * `toughness` directly almost everywhere, so transforming rewrites those
 * top-level fields from the new face and stashes the original card data to
 * restore later. Mana value stays the front face's (CR 712.8e) because
 * `cmc` is left untouched.
 *
 * Issue #2300 (Standard remainder slice).
 */
import type { GameState, CardInstance, CardInstanceId } from "../types";
import { ZoneType } from "../types";
import { KeywordActionResult } from "./shared";

export function isTransformingDfc(card: CardInstance): boolean {
  const data = card.transformOriginalCardData ?? card.cardData;
  return (
    data.layout === "transform" &&
    Array.isArray(data.card_faces) &&
    data.card_faces.length >= 2
  );
}

function isOnBattlefield(state: GameState, card: CardInstance): boolean {
  for (const zone of state.zones.values()) {
    if (zone.type === ZoneType.BATTLEFIELD && zone.cardIds.includes(card.id)) {
      return true;
    }
  }
  return false;
}

export function canTransform(
  state: GameState,
  cardId: CardInstanceId,
): { canTransform: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) return { canTransform: false, reason: "Card not found" };
  if (!isTransformingDfc(card)) {
    return {
      canTransform: false,
      reason: `${card.cardData.name} is not a transforming double-faced card`,
    };
  }
  if (card.isFaceDown) {
    return {
      canTransform: false,
      reason: "A face-down permanent can't transform",
    };
  }
  if (!isOnBattlefield(state, card)) {
    return {
      canTransform: false,
      reason: "Only a permanent on the battlefield can transform",
    };
  }
  return { canTransform: true };
}

/** Card data showing the given face of a transforming DFC. */
export function faceCardData(card: CardInstance, faceIndex: number) {
  const original = card.transformOriginalCardData ?? card.cardData;
  if (faceIndex === 0) return original;
  const face = original.card_faces![faceIndex];
  return {
    ...original,
    name: face.name,
    type_line: face.type_line ?? original.type_line,
    oracle_text: face.oracle_text ?? "",
    power: face.power,
    toughness: face.toughness,
  };
}

/** Turn a transformed card back to its front face (no-op otherwise). */
export function returnToFrontFace(card: CardInstance): CardInstance {
  if (!card.transformOriginalCardData && card.currentFaceIndex === 0)
    return card;
  if (!isTransformingDfc(card)) return card;
  const { transformOriginalCardData, ...rest } = card;
  return {
    ...rest,
    cardData: transformOriginalCardData ?? card.cardData,
    currentFaceIndex: 0,
  };
}

/**
 * Transform a permanent to its other face. Does nothing (success: false,
 * with a reason) for anything that can't transform.
 */
export function transformPermanent(
  state: GameState,
  cardId: CardInstanceId,
): KeywordActionResult {
  const check = canTransform(state, cardId);
  if (!check.canTransform) {
    return { success: false, state, description: "", error: check.reason };
  }
  const card = state.cards.get(cardId)!;
  const fromName = card.cardData.name;
  const nextFace = card.currentFaceIndex === 0 ? 1 : 0;
  const original = card.transformOriginalCardData ?? card.cardData;
  const updated: CardInstance =
    nextFace === 0
      ? returnToFrontFace(card)
      : {
          ...card,
          transformOriginalCardData: original,
          cardData: faceCardData(
            { ...card, transformOriginalCardData: original },
            1,
          ),
          currentFaceIndex: 1,
        };
  const cards = new Map(state.cards);
  cards.set(cardId, updated);
  return {
    success: true,
    state: { ...state, cards, lastModifiedAt: Date.now() },
    description: `${fromName} transforms into ${updated.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Whether an ability's effect text tells its source to transform itself:
 * "Transform Delver of Secrets.", "transform it", "transform this creature".
 * "transforms" / "transformed" (descriptions, "return it transformed") don't
 * count.
 */
export function isSelfTransformText(
  effectText: string,
  cardName: string,
): boolean {
  const lower = effectText.toLowerCase();
  const names = cardName
    .toLowerCase()
    .split(" // ")
    .map((n) => n.trim())
    .filter(Boolean);
  const self = [
    "it",
    "~",
    "this (?:creature|artifact|enchantment|land|permanent|planeswalker)",
    ...names.map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
  ].join("|");
  return new RegExp(`\\btransform (?:${self})(?=[.,;\\s]|$)`).test(lower);
}
