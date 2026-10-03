/**
 * Channel (ability word, e.g. Action News Crew): "Channel — {cost}, Discard
 * this card: <effect>". An activated ability that works only while the card
 * is in your hand. Issue #2300.
 *
 * Like `cycleCard`, the ability resolves immediately after its costs are paid
 * rather than waiting on the stack. Supported effect sentences: "Put a +1/+1
 * counter on each creature you control." and "Draw a card." / "Draw N cards."
 * Any other sentence is rejected before costs are paid.
 */
import type { GameState, CardInstanceId, PlayerId } from "../types";
import { spendMana } from "../mana";
import { parseManaCost } from "../oracle-text-parser/mana-cost";
import { isPriorityPlayer } from "../priority-guard";
import { addCounters } from "../card-instance";
import { drawCards } from "./draw";
import { moveCardToZone } from "./removal";
import { KeywordActionResult } from "./shared";

export interface ChannelInfo {
  /** Mana part of the cost, e.g. "{6}". */
  cost: string;
  /** Effect text after "Discard this card:". */
  effect: string;
}

const CHANNEL_RE =
  /Channel\s*[—–-]\s*((?:\{[^}]+\})+),\s*Discard this card:\s*([^\n]+)/i;

export function parseChannel(oracleText: string): ChannelInfo | null {
  if (!oracleText) return null;
  const m = oracleText.match(CHANNEL_RE);
  if (!m) return null;
  return { cost: m[1], effect: m[2].trim() };
}

type ChannelStep =
  | { kind: "counterEachYourCreature"; counterType: string; count: number }
  | { kind: "draw"; count: number };

const NUMBER_WORDS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
};

/** Split the effect into supported steps; null if any sentence is unknown. */
export function parseChannelEffect(effect: string): ChannelStep[] | null {
  const sentences = effect
    .split(/\.\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
  const steps: ChannelStep[] = [];
  for (const s of sentences) {
    const counter = s.match(
      /^Put (a|an|one|two|three|four) ([+-]\d+\/[+-]\d+) counters? on each creature you control$/i,
    );
    if (counter) {
      steps.push({
        kind: "counterEachYourCreature",
        counterType: counter[2],
        count: NUMBER_WORDS[counter[1].toLowerCase()],
      });
      continue;
    }
    const draw = s.match(/^Draw (a|one|two|three|four) cards?$/i);
    if (draw) {
      steps.push({ kind: "draw", count: NUMBER_WORDS[draw[1].toLowerCase()] });
      continue;
    }
    return null;
  }
  return steps.length > 0 ? steps : null;
}

export function hasChannel(oracleText: string): boolean {
  return parseChannel(oracleText) !== null;
}

/**
 * Activate a card's channel ability from its owner's hand: pay the mana,
 * discard the card, then apply the effect. Channel has no timing restriction,
 * so it only needs priority.
 */
export function channelCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): KeywordActionResult {
  const fail = (error: string): KeywordActionResult => ({
    success: false,
    state,
    description: "",
    error,
  });
  const card = state.cards.get(cardId);
  if (!card) return fail(`Card ${cardId} not found`);
  const info = parseChannel(card.cardData.oracle_text || "");
  if (!info) return fail(`${card.cardData.name} does not have channel.`);
  const hand = state.zones.get(`${playerId}-hand`);
  if (!hand || !hand.cardIds.includes(cardId)) {
    return fail("Channel can only be activated from your hand.");
  }
  if (state.status !== "in_progress") {
    return fail("Channel can only be activated during an in-progress game.");
  }
  if (!isPriorityPlayer(state, playerId)) {
    return fail("You do not have priority.");
  }
  const steps = parseChannelEffect(info.effect);
  if (!steps) {
    return fail(`Channel effect not supported yet: "${info.effect}"`);
  }

  let working = state;
  const cost = parseManaCost(info.cost);
  if (cost) {
    const spend = spendMana(working, playerId, {
      generic: cost.generic,
      colorless: cost.colorless,
      white: cost.white,
      blue: cost.blue,
      black: cost.black,
      red: cost.red,
      green: cost.green,
    });
    if (!spend.success) return fail("Not enough mana to channel.");
    working = spend.state;
  }

  const discard = moveCardToZone(working, cardId, "graveyard");
  if (!discard.success) {
    return fail(discard.error ?? "Failed to discard the channeled card.");
  }
  working = discard.state;

  const affected: CardInstanceId[] = [cardId];
  for (const step of steps) {
    if (step.kind === "counterEachYourCreature") {
      const bf = working.zones.get(`${playerId}-battlefield`);
      const cards = new Map(working.cards);
      for (const id of bf?.cardIds ?? []) {
        const c = cards.get(id);
        if (
          c &&
          c.controllerId === playerId &&
          (c.cardData.type_line || "").toLowerCase().includes("creature")
        ) {
          cards.set(id, addCounters(c, step.counterType, step.count));
          affected.push(id);
        }
      }
      working = { ...working, cards, lastModifiedAt: Date.now() };
    } else {
      const draw = drawCards(working, playerId, step.count);
      if (!draw.success) {
        return {
          success: false,
          state: draw.state,
          description: `Channeled ${card.cardData.name}, but could not draw`,
          error: draw.error ?? "Could not draw a card.",
          affectedCards: affected,
        };
      }
      working = draw.state;
      affected.push(...(draw.affectedCards ?? []));
    }
  }

  return {
    success: true,
    state: working,
    description: `Channeled ${card.cardData.name}: ${info.effect}`,
    affectedCards: affected,
  };
}
