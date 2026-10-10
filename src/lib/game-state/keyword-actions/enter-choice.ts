/**
 * "As this enters, choose a [thing]" — enter-time choice engine arm
 * (Wave 4.7 lane 39 + Wave 4.7 follow-up lane 44, #2594 follow-up).
 *
 * The drafter list flagged Heraldic Banner (chosen-color anthem +
 * chosen-color AddMana) and Banner of Kinship (chosen creature type)
 * as multi-lane blockers because the engine had no general-purpose
 * "as this enters, choose a [thing]" mechanism. Lane 39 filled that
 * gap for `kind: "color"`; lane 44 (#2705a) extends it for
 * `kind: "creature_type"`. Lane 45 adds the chosen-type anthem; the
 * `player` arm remains documented but unsupported.
 *
 * The flow mirrors the existing shockland-specific path
 * (`hasShocklandChoice`, CR 305.2) but lifts the choice type out of
 * the predicate: the engine asks the script for `enter_choice`, and
 * if it matches a supported kind, surfaces a `waitingChoice` of type
 * `enter_choice` to the controller. `resolveEnterChoice` stamps
 * `card.chosenColor` (lane 39) or `card.chosenCreatureType`
 * (lane 44) and clears the choice. Downstream statics and AddMana
 * substitute those fields for the `chosen` sentinel (lanes 40, 41,
 * and the upcoming 45).
 *
 * Sample cards: `Test Goggles` (cards/test_goggles_enter_choice.json)
 * exercises ONLY the lane 39 arm; Heraldic Banner (lanes 40 + 41)
 * reuses it; Banner of Kinship / Adaptive Automaton (lanes 44 + 45)
 * exercise the creature_type arm.
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
 * Curated creature-type list v1 supports as enter-time choices
 * (Wave 4.7 follow-up lane 44, #2705a). The ten most-common
 * creature types cover most real Anthems-of-Champions-style
 * cards (Banner of Kinship, Adaptive Automaton). Freeform
 * creature type entry is a UI follow-up.
 *
 * Stored with title case so the player's chosen value matches
 * the canonical subtype spelled on the chosen anthem
 * (e.g. "Soldier" matches `type_line: "Creature — Soldier"`).
 */
const CURATED_CREATURE_TYPES = [
  "Human",
  "Soldier",
  "Wizard",
  "Goblin",
  "Elf",
  "Vampire",
  "Dragon",
  "Merfolk",
  "Zombie",
  "Treefolk",
] as const;

type CuratedCreatureType = (typeof CURATED_CREATURE_TYPES)[number];

function isCuratedCreatureType(v: unknown): v is CuratedCreatureType {
  return (
    typeof v === "string" &&
    (CURATED_CREATURE_TYPES as readonly string[]).includes(v)
  );
}

/**
 * Return the curated choices list for a given `enter_choice.kind`.
 * Mirrors the schema's enum (color | creature_type | player) but
 * v1 only models `color` and `creature_type` — the `player` arm
 * is documented (#2705) but not implemented.
 */
export function enterChoiceOptionsForKind(
  kind: "color" | "creature_type" | "player",
): readonly string[] {
  switch (kind) {
    case "color":
      return COLOR_LETTERS;
    case "creature_type":
      return CURATED_CREATURE_TYPES;
    case "player":
      // "player" arm ships later (#2705 "Out of scope"). The
      // engine surfaces no choice list today; consumers must
      // check the kind separately.
      return [];
  }
}

/**
 * True iff the card carries a `script.enter_choice` whose `kind` is
 * supported by v1 (`"color"` or `"creature_type"` today). Lands use
 * `hasShocklandChoice`; this predicate covers scripted permanents
 * with an enter-time choice (Heraldic Banner, Banner of Kinship,
 * Test Goggles, …).
 */
export function hasEnterChoice(card: CardInstance): boolean {
  const script = getCardScript(card.cardData.name);
  if (!script) return false;
  const ec = script.enter_choice;
  if (!ec) return false;
  // Wave 4.7 lane 39 only modelled "color"; Wave 4.7 follow-up
  // lane 44 (#2705a) adds "creature_type". The "player" arm
  // remains documented-only and would crash if a card's script
  // ever opted in.
  return ec.kind === "color" || ec.kind === "creature_type";
}

/**
 * Build the `enter_choice` {@link WaitingChoice} for `cardId`, or
 * null when the card no longer carries an enter_choice script (e.g.
 * another player's removal resolved first). Dispatches on
 * `kind`: `"color"` → five-color set, `"creature_type"` →
 * curated type list.
 */
export function createEnterChoiceWaitingChoice(
  state: GameState,
  cardId: CardInstanceId,
): WaitingChoice | null {
  const card = state.cards.get(cardId);
  if (!card) return null;
  if (!hasEnterChoice(card)) return null;
  const script = getCardScript(card.cardData.name);
  // `hasEnterChoice` already filtered for a present + supported
  // script; the kind is therefore defined.
  const kind = script!.enter_choice!.kind;
  const options = enterChoiceOptionsForKind(kind);
  const choices: ChoiceOption[] = options.map((opt) => ({
    label: opt,
    value: opt,
    isValid: true,
  }));
  const name = card.cardData.name || "this permanent";
  // Prompt phrasing follows the script text verbatim when present;
  // fall back to a kind-appropriate sentence for synthetic tests.
  const scriptText = script!.enter_choice!.text;
  const prompt = scriptText ?? defaultPrompt(name, kind);
  return {
    type: ENTER_CHOICE_TYPE,
    playerId: card.controllerId,
    stackObjectId: null,
    prompt,
    choices,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

function defaultPrompt(
  name: string,
  kind: "color" | "creature_type" | "player",
): string {
  switch (kind) {
    case "color":
      return `As ${name} enters, choose a color.`;
    case "creature_type":
      return `As ${name} enters, choose a creature type.`;
    case "player":
      return `As ${name} enters, choose a player.`;
  }
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
 * Resolve a pending `enter_choice` waiting choice. `chosenValue`
 * must be one of the option values produced by
 * {@link createEnterChoiceWaitingChoice}. Dispatches on the
 * card's `enter_choice.kind`:
 *
 * - `"color"` (lane 39) → stamps `card.chosenColor` with one of
 *   `W`/`U`/`B`/`R`/`G`. Downstream statics (lane 40) and
 *   AddMana (lane 41) substitute the choice via the `chosen`
 *   sentinel.
 * - `"creature_type"` (lane 44) → stamps `card.chosenCreatureType`
 *   with one of the curated types. Downstream statics (lane 45)
 *   substitute the choice via the `chosen` sentinel on
 *   `affects.subtype`.
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
  // `chosenColor`/`chosenCreatureType` is still null and whose
  // script carries an `enter_choice` — deterministic and
  // unambiguous because the engine only surfaces one
  // `enter_choice` at a time.
  const cardId = resolveCardIdForChoice(state, choice);
  if (!cardId) {
    return { success: false, state, description: "Entering card not found" };
  }
  const card = state.cards.get(cardId);
  if (!card) {
    return { success: false, state, description: "Entering card not found" };
  }
  // Decide which field to stamp based on the script kind. The
  // engine recovered the card via `resolveCardIdForChoice` so the
  // script is guaranteed present + supported.
  const script = getCardScript(card.cardData.name);
  const kind = script!.enter_choice!.kind;
  const updatedCards = new Map(state.cards);
  if (kind === "color") {
    if (!isColorLetter(chosenValue)) {
      return {
        success: false,
        state,
        description: "Invalid enter choice value (expected W/U/B/R/G)",
      };
    }
    updatedCards.set(cardId, { ...card, chosenColor: chosenValue });
  } else if (kind === "creature_type") {
    if (!isCuratedCreatureType(chosenValue)) {
      return {
        success: false,
        state,
        description:
          "Invalid enter choice value (expected one of the curated creature types)",
      };
    }
    updatedCards.set(cardId, { ...card, chosenCreatureType: chosenValue });
  } else {
    // "player" arm is documented-only (#2705); the schema accepts
    // it but the engine has no choice list. Surface a friendly
    // error rather than silently misstamping.
    return {
      success: false,
      state,
      description: `enter_choice kind "${kind}" is not yet supported`,
    };
  }
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
  // matches an enter_choice script and still has its choice field
  // (chosenColor for "color", chosenCreatureType for
  // "creature_type") unset.
  const stacked = _choice.stackObjectId as CardInstanceId | null;
  if (stacked && state.cards.has(stacked) && hasEnterChoice(state.cards.get(stacked)!)) {
    return stacked;
  }
  for (const card of state.cards.values()) {
    if (!hasEnterChoice(card)) continue;
    if (card.controllerId !== _choice.playerId) continue;
    if (card.currentZoneKey !== `${card.controllerId}-battlefield`) continue;
    const script = getCardScript(card.cardData.name);
    const kind = script!.enter_choice!.kind;
    const choicePending =
      (kind === "color" && card.chosenColor === null) ||
      (kind === "creature_type" && card.chosenCreatureType === null);
    if (choicePending) return card.id;
  }
  return null;
}
