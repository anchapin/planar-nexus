/**
 * Domain ability word (issue #2300): Fblthp, Knows the Way.
 *
 * "Domain — Fblthp's power is equal to the number of basic land types among
 * lands you control." This is a characteristic-defining ability (CR 604.3,
 * layer 7a). `getEffectivePower` only sees the card, so the value is kept on
 * `CardInstance.domainPower` and refreshed with the state-based-action pass,
 * the same way threshold bonuses are.
 */
import type { CardInstance, GameState, PlayerId } from "../types";

export const BASIC_LAND_TYPES = [
  "Plains",
  "Island",
  "Swamp",
  "Mountain",
  "Forest",
] as const;

const DOMAIN_POWER_CDA =
  /\bdomain\b[^.]*?\bpower is equal to the number of basic land types among lands you control\b/i;

/**
 * "This Vehicle's power is equal to the number of lands you control."
 * (Lumbering Worldwagon, #2614). Same layer-7a CDA slot as domain, so the
 * value also lives on `domainPower`.
 */
const LANDS_POWER_CDA =
  /\bpower is equal to the number of lands you control\b/i;

/** Number of lands the player controls. */
export function countLands(state: GameState, playerId: PlayerId): number {
  const zone = state.zones.get(`${playerId}-battlefield`);
  if (!zone) return 0;
  let count = 0;
  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId);
    if (!card || card.controllerId !== playerId) continue;
    if (/\bLand\b/.test(card.cardData.type_line ?? "")) count++;
  }
  return count;
}

/** True when the card's power is the number of lands its controller has. */
export function hasLandsPowerCDA(card: CardInstance): boolean {
  return LANDS_POWER_CDA.test(card.cardData.oracle_text ?? "");
}

/** Number of basic land types among lands the player controls (0-5). */
export function countBasicLandTypes(
  state: GameState,
  playerId: PlayerId,
): number {
  const zone = state.zones.get(`${playerId}-battlefield`);
  if (!zone) return 0;
  const found = new Set<string>();
  for (const cardId of zone.cardIds) {
    const card = state.cards.get(cardId);
    if (!card || card.controllerId !== playerId) continue;
    const typeLine = card.cardData.type_line ?? "";
    if (!/\bLand\b/.test(typeLine)) continue;
    const subtypes = typeLine.split(/\s+[\u2014-]\s+/)[1] ?? "";
    for (const basic of BASIC_LAND_TYPES) {
      if (new RegExp(`\\b${basic}\\b`).test(subtypes)) found.add(basic);
    }
  }
  return found.size;
}

/** True when the card's power is defined by domain. */
export function hasDomainPowerCDA(card: CardInstance): boolean {
  return DOMAIN_POWER_CDA.test(card.cardData.oracle_text ?? "");
}

/**
 * Recompute `domainPower` for every domain or lands-count CDA card. Returns the same state
 * object when nothing changed.
 */
export function refreshDomainPower(state: GameState): GameState {
  let cards: GameState["cards"] | null = null;
  const counts = new Map<PlayerId, number>();
  const landCounts = new Map<PlayerId, number>();
  for (const [cardId, card] of state.cards) {
    const lands = hasLandsPowerCDA(card);
    if (!lands && !hasDomainPowerCDA(card)) continue;
    const controller = card.controllerId;
    const cache = lands ? landCounts : counts;
    let value = cache.get(controller);
    if (value === undefined) {
      value = lands
        ? countLands(state, controller)
        : countBasicLandTypes(state, controller);
      cache.set(controller, value);
    }
    if (card.domainPower === value) continue;
    cards ??= new Map(state.cards);
    cards.set(cardId, { ...card, domainPower: value });
  }
  return cards ? { ...state, cards } : state;
}
