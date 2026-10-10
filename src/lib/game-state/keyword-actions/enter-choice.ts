/**
 * "As this enters, choose a [thing]" — enter-time choice engine arm
 * (Wave 4.7 lane 39, #2594 follow-up).
 *
 * The drafter list flagged Heraldic Banner (chosen-color anthem +
 * chosen-color AddMana) and Banner of Kinship (chosen creature type)
 * as multi-lane blockers because the engine had no general-purpose
 * "as this enters, choose a [thing]" mechanism. This module fills
 * that gap for `kind: "color"`. Future lanes (40, 41) add the
 * anthem and AddMana arms; `creature_type` and `player` kinds
 * remain documented but unsupported at this point.
 *
 * The flow mirrors the existing shockland-specific path
 * (`hasShocklandChoice`, CR 305.2) but lifts the choice type out of
 * the predicate: the engine asks the script for `enter_choice`, and
 * if it matches a supported kind, surfaces a `waitingChoice` of type
 * `enter_choice` to the controller. `resolveEnterChoice` stamps
 * `card.chosenColor` and clears the choice. Downstream statics and
 * AddMana substitute that field for the `chosen` sentinel (lanes
 * 40 + 41).
 *
 * Sample card: `Test Goggles` (cards/test_goggles_enter_choice.json)
 * exercises ONLY this arm; Heraldic Banner (lanes 40 + 41) will
 * reuse it.
 */
import type {
  CardInstance,
  CardInstanceId,
  ChoiceOption,
  GameState,
  PlayerId,
  WaitingChoice,
} from "../types";
import { getCardScript } from "../card-scripts/registry";

/** The WaitingChoice.type string the engine surfaces for an enter_choice. */
export const ENTER_CHOICE_TYPE = "enter_choice" as const;

/** Color letters v1 supports as enter-time choices. */
const COLOR_LETTERS = ["W", "U", "B", "R", "G"] as const;
type ColorLetter = (typeof COLOR_LETTERS)[number];

function isColorLetter(v: unknown): v is ColorLetter {
  return (
    typeof v === "string" && (COLOR_LETTERS as readonly string[]).includes(v)
  );
}

/**
 * True iff the card carries a `script.enter_choice` whose `kind` is
 * supported by v1 (only "color" today). Lands use
 * `hasShocklandChoice`; this predicate covers scripted permanents
 * with an enter-time color choice (Heraldic Banner, Test Goggles,
 * …).
 */
export function hasEnterChoice(card: CardInstance): boolean {
  const script = getCardScript(card.cardData.name);
  if (!script) return false;
  const ec = script.enter_choice;
  if (!ec) return false;
  // v1 only models "color". creature_type and player are rejected by
  // the schema today and would crash if a card's script ever opted in.
  return ec.kind === "color";
}

/**
 * Build the `enter_choice` {@link WaitingChoice} for `cardId`, or
 * null when the card no longer carries an enter_choice script (e.g.
 * another player's removal resolved first). The options list is the
 * five-color set for `kind: "color"`.
 */
export function createEnterChoiceWaitingChoice(
  state: GameState,
  cardId: CardInstanceId,
): WaitingChoice | null {
  const card = state.cards.get(cardId);
  if (!card) return null;
  if (!hasEnterChoice(card)) return null;
  const choices: ChoiceOption[] = COLOR_LETTERS.map((letter) => ({
    label: letter,
    value: letter,
    isValid: true,
  }));
  const name = card.cardData.name || "this permanent";
  return {
    type: ENTER_CHOICE_TYPE,
    playerId: card.controllerId,
    stackObjectId: null,
    prompt: `As ${name} enters, choose a color.`,
    choices,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Result of {@link resolveEnterChoice}.
 */
export interface EnterChoiceResolution {
  success: boolean;
  state: GameState;
  description: string;
}

/**
 * Resolve a pending `enter_choice` waiting choice. `chosenValue` is
 * one of the W/U/B/R/G option values produced by
 * {@link createEnterChoiceWaitingChoice}. Stamps the card's
 * `chosenColor` and clears the choice. On success the card's static
 * anthem and AddMana (lanes 40 + 41) can substitute the chosen
 * color via the `chosen` sentinel.
 */
export function resolveEnterChoice(
  state: GameState,
  playerId: PlayerId,
  chosenValue: string,
): EnterChoiceResolution {
  const choice = state.waitingChoice;
  if (!choice || choice.type !== ENTER_CHOICE_TYPE) {
    return { success: false, state, description: "No pending enter choice" };
  }
  if (choice.playerId !== playerId) {
    return {
      success: false,
      state,
      description: "Not this player's enter choice to resolve",
    };
  }
  if (!isColorLetter(chosenValue)) {
    return {
      success: false,
      state,
      description: "Invalid enter choice value (expected W/U/B/R/G)",
    };
  }
  const validOption = choice.choices.find(
    (c) => String(c.value) === chosenValue,
  );
  if (!validOption || !validOption.isValid) {
    return {
      success: false,
      state,
      description: "Invalid choice for pending enter choice",
    };
  }
  // The card id lives on the choice's stackObjectId only when a
  // scripted trigger introduced it; for enter_choice the engine
  // embeds the cardId in the prompt's first sentence. To keep the
  // path stateless we recover the cardId from the choice's
  // `stackObjectId` slot when set; otherwise we read it from the
  // FIRST card on the entering controller's battlefield whose
  // `chosenColor` is still null and whose script carries an
  // `enter_choice` — deterministic and unambiguous because the
  // engine only surfaces one enter_choice at a time.
  const cardId = resolveCardIdForChoice(state, choice);
  if (!cardId) {
    return { success: false, state, description: "Entering card not found" };
  }
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state, description: "Entering card not found" };
  }
  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, { ...card, chosenColor: chosenValue });
  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      waitingChoice: null,
      lastModifiedAt: Date.now(),
    },
    description: `Chose ${chosenValue} for ${card.cardData.name}`,
  };
}

function resolveCardIdForChoice(
  state: GameState,
  _choice: WaitingChoice,
): CardInstanceId | null {
  // The engine stamps the entering cardId into the choice's
  // `stackObjectId` slot when it builds the choice; that's the
  // fastest path. For choices built by other entry points, fall
  // back to scanning the battlefield for the first card that
  // matches an enter_choice script and still has chosenColor
  // null.
  const stacked = _choice.stackObjectId as CardInstanceId | null;
  if (stacked && state.cards.has(stacked) && hasEnterChoice(state.cards.get(stacked)!)) {
    return stacked;
  }
  for (const card of state.cards.values()) {
    if (
      hasEnterChoice(card) &&
      card.chosenColor === null &&
      card.controllerId === _choice.playerId &&
      card.currentZoneKey === `${card.controllerId}-battlefield`
    ) {
      return card.id;
    }
  }
  return null;
}
