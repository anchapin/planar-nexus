/**
 * AI answers for "you may pay" offer choices (issue #2443).
 *
 * `corpse_offer`, `tribute_offer` and `attack_return_offer` waiting choices
 * can be answered by a human through `resolveWaitingChoice` and the game
 * board's mode dialog. Without this module nothing answered an offer that
 * surfaced for the AI player, so the game sat on an unanswered choice.
 *
 * Policy: every offer the engine surfaces is optional upside for whoever
 * pays (Corpse applies its effect, Tribute suppresses the opponent's
 * tribute effect, an attack return puts an attacker back on the
 * battlefield). The engine already marks the pay option `isValid: false`
 * when the cost cannot be met, so the AI pays whenever the pay option is
 * valid and declines otherwise. If paying still fails at resolution (the
 * mana was spent in between), the AI declines so its turn never stalls.
 */
import type { GameState, PlayerId, WaitingChoice } from "@/lib/game-state";
import { resolveWaitingChoice } from "@/lib/game-state";
import { pickDiscardCandidates } from "./cleanup-discard";
import type { DifficultyLevel } from "./ai-difficulty";

export const AI_OFFER_CHOICE_TYPES: ReadonlySet<WaitingChoice["type"]> =
  new Set<WaitingChoice["type"]>([
    "corpse_offer",
    "tribute_offer",
    "attack_return_offer",
  ]);

/**
 * True when `choice` is the cleanup discard to maximum hand size (#2446),
 * which `answerAIOfferChoices` also answers for the AI.
 */
export function isHandSizeDiscardChoice(
  choice: WaitingChoice | null | undefined,
): choice is WaitingChoice {
  return choice?.type === "discard_to_hand_size";
}

/** True when `choice` is one of the "you may pay" offers this module answers. */
export function isOfferChoice(
  choice: WaitingChoice | null | undefined,
): choice is WaitingChoice {
  return !!choice && AI_OFFER_CHOICE_TYPES.has(choice.type);
}

function optionValue(choice: WaitingChoice, prefixes: string[]): string | null {
  for (const option of choice.choices) {
    if (!option.isValid || typeof option.value !== "string") continue;
    const value = option.value;
    if (prefixes.some((p) => value.startsWith(p))) return value;
  }
  return null;
}

/** The decline value for an offer, or null when the offer has none. */
export function declineValue(choice: WaitingChoice): string | null {
  return optionValue(choice, ["decline:"]);
}

/**
 * Pick the AI's answer to an offer: pay (or accept) when the engine marks
 * that option valid, otherwise decline. Null when the offer has no usable
 * option at all.
 */
export function decideOfferChoice(choice: WaitingChoice): string | null {
  return optionValue(choice, ["pay:", "accept:"]) ?? declineValue(choice);
}

/**
 * Pick the AI's cleanup discard (CR 514.1, issue #2446): the per-difficulty
 * ranked candidates from `pickDiscardCandidates`, topped up from the end of
 * the hand when the helper endorses fewer cards than must go.
 */
export function decideHandSizeDiscard(
  state: GameState,
  choice: WaitingChoice,
  difficulty: DifficultyLevel = "medium",
): string[] {
  const need = choice.minChoices;
  const hand = choice.choices
    .filter((o) => o.isValid && typeof o.value === "string")
    .map((o) => o.value as string);
  const inHand = new Set(hand);
  const picked: string[] = [];
  const ranked = pickDiscardCandidates(state, choice.playerId, {
    difficulty,
  }).candidates;
  for (const id of ranked) {
    if (picked.length >= need) break;
    if (inHand.has(id) && !picked.includes(id)) picked.push(id);
  }
  for (let i = hand.length - 1; i >= 0 && picked.length < need; i--) {
    if (!picked.includes(hand[i])) picked.push(hand[i]);
  }
  return picked;
}

export interface AIOfferAnswer {
  type: WaitingChoice["type"];
  value: string;
}

/**
 * Answer every offer waiting on `aiPlayerId`, one at a time, until the
 * pending choice is gone or belongs to someone else. Offers queue (several
 * Corpse creatures dying together surface one after another), so this loops
 * with a step cap as a guard against a resolver that never clears.
 */
export function answerAIOfferChoices(
  state: GameState,
  aiPlayerId: PlayerId,
  maxSteps = 16,
  difficulty: DifficultyLevel = "medium",
): { state: GameState; answered: AIOfferAnswer[] } {
  let current = state;
  const answered: AIOfferAnswer[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const choice = current.waitingChoice;
    if (!choice || choice.playerId !== aiPlayerId) break;

    // Issue #2446: the cleanup discard also waits on the AI before its
    // turn can end.
    if (choice.type === "discard_to_hand_size") {
      const cards = decideHandSizeDiscard(current, choice, difficulty);
      const result = resolveWaitingChoice(current, aiPlayerId, cards);
      if (!result.success) break;
      answered.push({ type: choice.type, value: `discard:${cards.join(",")}` });
      current = result.state;
      continue;
    }

    if (!isOfferChoice(choice)) break;

    const value = decideOfferChoice(choice);
    if (!value) break;

    let result = resolveWaitingChoice(current, aiPlayerId, value);
    let used = value;
    if (!result.success || result.state.waitingChoice === choice) {
      const decline = declineValue(choice);
      if (!decline || decline === value) break;
      result = resolveWaitingChoice(current, aiPlayerId, decline);
      used = decline;
      if (!result.success) break;
    }

    answered.push({ type: choice.type, value: used });
    current = result.state;
  }

  return { state: current, answered };
}
