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

export const AI_OFFER_CHOICE_TYPES: ReadonlySet<WaitingChoice["type"]> =
  new Set<WaitingChoice["type"]>([
    "corpse_offer",
    "tribute_offer",
    "attack_return_offer",
  ]);

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
): { state: GameState; answered: AIOfferAnswer[] } {
  let current = state;
  const answered: AIOfferAnswer[] = [];

  for (let step = 0; step < maxSteps; step++) {
    const choice = current.waitingChoice;
    if (!isOfferChoice(choice) || choice.playerId !== aiPlayerId) break;

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
