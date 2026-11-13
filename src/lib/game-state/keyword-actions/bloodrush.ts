/**
 * Bloodrush (CR 702.103, issue #2951).
 *
 * "Bloodrush — {cost}, Discard this card: Target creature gets +X/+X until
 * end of turn", where X is the discarded card's own power and toughness.
 *
 * Like `channelCard`, the ability resolves as soon as its costs are paid
 * instead of waiting on the stack. The card must be in the activating
 * player's hand, the player must have priority, and the target must be an
 * attacking creature.
 *
 * The pump is applied with the engine's existing until-end-of-turn modifier
 * handling (`addUntilEndOfTurnPT`), so it expires with the rest of the
 * end-of-turn cleanup.
 */
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { spendMana } from "../mana";
import { parseManaCost } from "../oracle-text-parser/mana-cost";
import { isPriorityPlayer } from "../priority-guard";
import {
  getEffectivePower,
  getEffectiveToughness,
} from "../evergreen-keywords";
import { addUntilEndOfTurnPT } from "../pt-until-end-of-turn";
import { moveCardToZone } from "./removal";
import { KeywordActionResult } from "./shared";

const BLOODRUSH_RE =
  /Bloodrush\s*[—–-]\s*((?:\{[^}]+\})+),\s*Discard this card:/i;

/**
 * The mana cost of the card's bloodrush ability, e.g. "{2}{B}", or null when
 * the card has no bloodrush line.
 */
export function parseBloodrush(oracleText: string): string | null {
  if (!oracleText) return null;
  const m = oracleText.match(BLOODRUSH_RE);
  return m ? m[1] : null;
}

export function hasBloodrush(oracleText: string): boolean {
  return parseBloodrush(oracleText) !== null;
}

/** True when `cardId` is a creature permanent. */
function isCreature(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards.get(cardId);
  if (!card) return false;
  return (card.cardData.type_line || "").toLowerCase().includes("creature");
}

/**
 * Activate a card's bloodrush ability from its owner's hand: pay the mana,
 * discard the card, then give the target attacking creature +P/+T (the
 * discarded card's own power and toughness) until end of turn.
 */
export function activateBloodrush(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  targetId: CardInstanceId,
): KeywordActionResult {
  const fail = (error: string): KeywordActionResult => ({
    success: false,
    state,
    description: "",
    error,
  });
  const card = state.cards.get(cardId);
  if (!card) return fail(`Card ${cardId} not found`);
  const cost = parseBloodrush(card.cardData.oracle_text || "");
  if (!cost) return fail(`${card.cardData.name} does not have bloodrush.`);
  const hand = state.zones.get(`${playerId}-hand`);
  if (!hand || !hand.cardIds.includes(cardId)) {
    return fail("Bloodrush can only be activated from your hand.");
  }
  if (state.status !== "in_progress") {
    return fail("Bloodrush can only be activated during an in-progress game.");
  }
  if (!isPriorityPlayer(state, playerId)) {
    return fail("You do not have priority.");
  }
  const target = state.cards.get(targetId);
  if (!target) return fail(`Target ${targetId} not found`);
  if (!isCreature(state, targetId)) {
    return fail("That target is not a creature.");
  }
  if (!state.combat.attackers.some((a) => a.cardId === targetId)) {
    return fail("That creature is not attacking.");
  }

  // Snapshot the discarded card's own power and toughness before it leaves
  // the hand (CR 702.103).
  const power = getEffectivePower(card);
  const toughness = getEffectiveToughness(card);

  let working = state;
  const mana = parseManaCost(cost);
  if (mana) {
    const spend = spendMana(working, playerId, {
      generic: mana.generic,
      colorless: mana.colorless,
      white: mana.white,
      blue: mana.blue,
      black: mana.black,
      red: mana.red,
      green: mana.green,
    });
    if (!spend.success) return fail("Not enough mana to bloodrush.");
    working = spend.state;
  }

  const discard = moveCardToZone(working, cardId, "graveyard");
  if (!discard.success) {
    return fail(discard.error ?? "Failed to discard the bloodrushed card.");
  }
  working = discard.state;

  working = addUntilEndOfTurnPT(working, targetId, power, toughness);

  return {
    success: true,
    state: working,
    description: `${card.cardData.name} bloodrush: ${target.cardData.name} gets +${power}/+${toughness} until end of turn.`,
    affectedCards: [cardId, targetId],
  };
}
