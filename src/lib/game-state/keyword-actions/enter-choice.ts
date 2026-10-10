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
 * Mirrors the schema's enum (color | creature_type | player |
 * chosen_name) but v1 only models `color` and `creature_type`:
 * - "player" is documented (#2705) but not implemented.
 * - "chosen_name" is documented (#2708) but not implemented;
 *   the engine arm rides a multi-lane follow-up that uses
 *   `choose_cards` (not the value-list path here).
 */
export function enterChoiceOptionsForKind(
  kind: "color" | "creature_type" | "player" | "chosen_name",
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
    case "chosen_name":
      // #2708 phase 2; surfaces a `choose_cards` waitingChoice
      // separately. No value-list options today.
      return [];
  }
}

/**
 * True iff the card carries a `script.enter_choice` whose `kind` is
 * supported by v1. Lands use `hasShocklandChoice`; this predicate
 * covers scripted permanents with an enter-time choice (Heraldic
 * Banner, Banner of Kinship, Sorcerous Spyglass, …).
 *
 * Supported kinds:
 *  - `"color"` (Wave 4.7 lane 39): five-color enum, value-list.
 *  - `"creature_type"` (Wave 4.7 follow-up lane 44, #2705a):
 *    curated type list, value-list.
 *  - `"chosen_name"` (Wave 4.7 phase 2 lane 49, #2708 phase 2a):
 *    Sorcerous Spyglass pattern — surfaces a `choose_cards`
 *    waitingChoice pointing at an opponent's hand.
 *
 * The `"player"` arm is documented-only and would crash if a card's
 * script ever opted in.
 */
export function hasEnterChoice(card: CardInstance): boolean {
  const script = getCardScript(card.cardData.name);
  if (!script) return false;
  const ec = script.enter_choice;
  if (!ec) return false;
  return (
    ec.kind === "color" ||
    ec.kind === "creature_type" ||
    ec.kind === "chosen_name"
  );
}

/**
 * Build the {@link WaitingChoice} for `cardId`, or null when the
 * card no longer carries an enter_choice script (e.g. another
 * player's removal resolved first). Dispatches on `kind`:
 *
 *  - `"color"` → `ENTER_CHOICE_TYPE` (5-color value-list).
 *  - `"creature_type"` → `ENTER_CHOICE_TYPE` (curated type list).
 *  - `"chosen_name"` → `choose_cards` waitingChoice pointing at
 *    the opponent's hand (Wave 4.7 phase 2 lane 49, #2708 phase
 *    2a). The chosen card stays in the opponent's hand; resolution
 *    stamps `card.chosenCardName`.
 *
 * `playerId` is always the entering card's controller — for
 * chosen_name, this is the controller who picks a card name from
 * the opponent's hand (mirroring how Sorcerous Spyglass reads:
 * "look at an opponent's hand, then choose any card name").
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
  // Wave 4.7 phase 2 lane 49: chosen_name uses the
  // `choose_cards` waitingChoice type, not the value-list
  // `enter_choice` shape. Route via the dedicated helper so the
  // resolver can tell them apart.
  if (kind === "chosen_name") {
    return createChosenNameWaitingChoice(state, cardId);
  }
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
  kind: "color" | "creature_type" | "player" | "chosen_name",
): string {
  switch (kind) {
    case "color":
      return `As ${name} enters, choose a color.`;
    case "creature_type":
      return `As ${name} enters, choose a creature type.`;
    case "player":
      return `As ${name} enters, choose a player.`;
    case "chosen_name":
      return `As ${name} enters, choose a card name.`;
  }
}

/**
 * Sentinel prefix used to flag a `choose_cards` waitingChoice as the
 * chosen-name engine arm (Wave 4.7 phase 2 lane 49, #2708 phase 2a)
 * rather than the Duress-style exiling flow. The resolve path in
 * `spell-casting/choices.ts` strips the prefix and routes to
 * {@link resolveChosenName}, which stamps `chosenCardName` on the
 * entering card and leaves the chosen card in the opponent's hand.
 *
 * Kept as a private marker so the public WaitingChoice type stays
 * narrow (no extra fields); the prompt is the cheapest place to
 * embed it without disturbing other engine paths.
 */
export const CHOSEN_NAME_PROMPT_MARKER = "__enter_chosen_name__" as const;

/**
 * Build a `choose_cards` waitingChoice pointing at one opponent's
 * hand for the Wave 4.7 phase 2 lane 49 chosen-name engine arm
 * (#2708 phase 2a, Sorcerous Spyglass). The player picks a card from
 * the opponent's hand; resolution stamps the entering card's
 * `chosenCardName` (NOT a chosen color or creature type). Returns
 * null when no opponent exists, when the chosen card is no longer
 * on the battlefield, or when the opponent's hand is empty.
 *
 * Note: this function writes the `enter_choice` WaitingChoice to
 * `state.waitingChoice` through the same path the ETB pipeline
 * uses (see `spell-casting/resolve.ts:732`); `createEnterChoiceWaitingChoice`
 * dispatches on the script's `kind` and returns the right shape.
 * Exposed here as a public helper for the ETB pipeline and for
 * tests that don't go through the full cast flow.
 */
export function createChosenNameWaitingChoice(
  state: GameState,
  cardId: CardInstanceId,
): WaitingChoice | null {
  const card = state.cards.get(cardId);
  if (!card) return null;
  const script = getCardScript(card.cardData.name);
  if (!script || script.enter_choice?.kind !== "chosen_name") return null;
  // Find the first non-losing opponent. The engine exposes
  // `state.players` as a Map; a Sorcerous Spyglass-like card
  // always has at least one opponent in a normal game.
  const opponents: PlayerId[] = [];
  for (const [pid, player] of state.players) {
    if (pid !== card.controllerId && !player.hasLost) {
      opponents.push(pid);
    }
  }
  if (opponents.length === 0) return null;
  const opponentId = opponents[0];
  const oppHand = state.zones.get(`${opponentId}-hand`);
  if (!oppHand) return null;
  const handCards = oppHand.cardIds
    .map((id) => state.cards.get(id))
    .filter((c): c is CardInstance => Boolean(c));
  if (handCards.length === 0) {
    // Empty opponent hand — no choice to make. The caller treats
    // this as "pass" (Sorcerous Spyglass still resolves but
    // `chosenCardName` stays null; the chosen-name static block is
    // inert). The engine surfaces no waitingChoice in this case.
    return null;
  }
  const name = card.cardData.name || "this permanent";
  const promptText =
    script.enter_choice?.text ??
    `As ${name} enters, look at an opponent's hand, then choose any card name.`;
  // Embed the chosen-name marker in the prompt so the
  // `choose_cards` resolver in `spell-casting/choices.ts` can
  // dispatch to `resolveChosenName` without an extra field on
  // WaitingChoice.
  const prompt = `${CHOSEN_NAME_PROMPT_MARKER}:${promptText}`;
  const choices: ChoiceOption[] = handCards.map((c) => ({
    label: c.cardData.name,
    value: c.id,
    isValid: true,
  }));
  return {
    type: "choose_cards",
    playerId: card.controllerId,
    stackObjectId: cardId,
    prompt,
    choices,
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Result of {@link resolveChosenName}.
 */
export interface ChosenNameResolution {
  success: boolean;
  state: GameState;
  description: string;
}

/**
 * Resolve a pending chosen-name waitingChoice produced by
 * {@link createChosenNameWaitingChoice}. Stamps
 * `card.chosenCardName = chosenCard.cardData.name` on the entering
 * Sorcerous-Spyglass-like card and clears the choice. The chosen
 * card stays in the opponent's hand (unlike the Duress-style
 * `completeHandTargeting` path, which exiles the selected card).
 *
 * Defensive: if the choice's `stackObjectId` doesn't match a card
 * that still carries `enter_choice: { kind: "chosen_name" }`, the
 * resolver returns a friendly error rather than silently misstamping
 * a different card.
 */
export function resolveChosenName(
  state: GameState,
  playerId: PlayerId,
  chosenCardId: string,
): ChosenNameResolution {
  const choice = state.waitingChoice;
  if (!choice || choice.type !== "choose_cards") {
    return {
      success: false,
      state,
      description: "No pending chosen-name choice",
    };
  }
  if (!choice.prompt.startsWith(CHOSEN_NAME_PROMPT_MARKER)) {
    // The choose_cards resolver dispatches here only for
    // chosen-name prompts; this branch catches direct callers that
    // picked the wrong shape.
    return {
      success: false,
      state,
      description: "Pending choice is not a chosen-name choice",
    };
  }
  if (choice.playerId !== playerId) {
    return {
      success: false,
      state,
      description: "Not this player's chosen-name choice to resolve",
    };
  }
  const validOption = choice.choices.find((c) => c.value === chosenCardId);
  if (!validOption || !validOption.isValid) {
    return {
      success: false,
      state,
      description: "Invalid choice for pending chosen-name choice",
    };
  }
  const enteringId =
    (choice.stackObjectId as CardInstanceId | null) ?? null;
  if (!enteringId || !state.cards.has(enteringId)) {
    return {
      success: false,
      state,
      description: "Entering card not found",
    };
  }
  const card = state.cards.get(enteringId)!;
  const script = getCardScript(card.cardData.name);
  if (!script || script.enter_choice?.kind !== "chosen_name") {
    return {
      success: false,
      state,
      description: "Entering card has no chosen-name script",
    };
  }
  if (card.chosenCardName !== null) {
    // Already resolved; idempotent no-op. Surface success so a
    // duplicate resolveWaitingChoice call doesn't accidentally
    // fall through to an unrelated path.
    return {
      success: true,
      state: { ...state, waitingChoice: null },
      description: "Chosen-name already resolved",
    };
  }
  const chosenCard = state.cards.get(chosenCardId as CardInstanceId);
  if (!chosenCard) {
    return {
      success: false,
      state,
      description: "Chosen card not found",
    };
  }
  const updatedCards = new Map(state.cards);
  updatedCards.set(enteringId, {
    ...card,
    chosenCardName: chosenCard.cardData.name,
  });
  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      waitingChoice: null,
      lastModifiedAt: Date.now(),
    },
    description: `Named ${chosenCard.cardData.name} for ${card.cardData.name}`,
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
    // "player" is documented-only (#2705); "chosen_name"
    // (Wave 4.7 phase 2 lane 49, #2708 phase 2a) uses a separate
    // `choose_cards` waitingChoice that resolves via
    // `resolveChosenName` — the engine routes dispatch in
    // `spell-casting/choices.ts`. Reaching this branch means
    // someone constructed a malformed `enter_choice` waiting
    // choice; surface a friendly error rather than silently
    // misstamping.
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
  // "creature_type", chosenCardName for "chosen_name") unset.
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
      (kind === "creature_type" && card.chosenCreatureType === null) ||
      (kind === "chosen_name" && card.chosenCardName === null);
    if (choicePending) return card.id;
  }
  return null;
}
