/**
 * Waiting-choice types: pending choices offered to players and their options.
 *
 * Mechanically extracted from types.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import { PlayerId } from "./players";
import { StackObjectId } from "./stack";

/**
 * Choice that needs to be made
 */
export interface WaitingChoice {
  /** Type of choice needed */
  type:
    | "choose_targets"
    | "choose_mode"
    | "choose_value"
    | "choose_cards"
    | "yes_no"
    | "payment"
    | "attackers"
    | "blockers"
    | "ordering"
    | "priority"
    | "choose_legend"
    | "choose_replacement"
    | "corpse_offer"
    | "tribute_offer"
    | "attack_return_offer"
    | "discard_to_hand_size"
    | "discard_cards"
    | // Wave 4.7 lane 39 (#2594 follow-up): "as this enters,
      // choose a [thing]". Surfaced by `createEnterChoiceWaitingChoice`
      // (keyword-actions/enter-choice.ts) on a scripted permanent with
      // `enter_choice: { kind: "color" }`; resolved by
      // `resolveEnterChoice`, which stamps `card.chosenColor`.
      "enter_choice"
    | // Wave 4.8 follow-up 2 lane 60 (#2614 follow-up): a
      // scripted trigger with `you_may: true` (CR 117.3a "you may").
      // Surfaced by `card-scripts/interpret.ts#resolveScriptedAbility`
      // when the trigger is about to apply its effects; resolved by
      // the `you_may_prompt` branch in spell-casting/choices.ts, which
      // stamps `stackObject.you_may_resolved` and returns the
      // controller to the trigger resolution path.
      "you_may_prompt"
    | // Wave 4.8 follow-up 12 lane 88 (#2614 follow-up): a
      // scripted trigger with `cost.sacrifice_self: true` (CR 602.2b
      // "Sacrifice this [permanent]:" as a trigger cost). Surfaced by
      // `card-scripts/interpret.ts#resolveScriptedAbility` at
      // resolution; resolved by the `sacrifice_self_prompt` branch
      // in spell-casting/choices.ts (parallel to `you_may_prompt`),
      // which stamps `stackObject.cost_paid` and returns the
      // controller to the resolution path.
      "sacrifice_self_prompt"
    | // Wave 4.8 follow-up 13 lane 98 (#2614 follow-up): a
      // scripted trigger with `cost.discard: { amount: N }` (CR
      // 602.2b "Discard a card:" as a trigger cost — Storm Fleet
      // Spy variant). Surfaced by
      // `card-scripts/interpret.ts#resolveScriptedAbility` at
      // resolution; resolved by the `discard_prompt` branch in
      // spell-casting/choices.ts (parallel to `sacrifice_self_prompt`),
      // which stamps `stackObject.cost_paid` and returns the
      // controller to the trigger resolution path.
      "discard_prompt"
    | // Wave 4.8 follow-up 13 lane 106 (#2614 follow-up): a
      // scripted trigger with `cost.pay_life: { amount: N }` (CR
      // 602.2b "Pay N life:" as a trigger cost — Aether Burst /
      // Skeleton Scarab / Necropotence-style). Surfaced by
      // `card-scripts/interpret.ts#resolveScriptedAbility` at
      // resolution; resolved by the `pay_life_prompt` branch
      // in spell-casting/choices.ts (parallel to
      // `sacrifice_self_prompt` / `discard_prompt`), which
      // stamps `stackObject.cost_paid` and returns the
      // controller to the trigger resolution path.
      "pay_life_prompt";
  /** ID of player who needs to make this choice */
  playerId: PlayerId;
  /** ID of the stack object this choice is for */
  stackObjectId: StackObjectId | null;
  /** Prompt text to display */
  prompt: string;
  /** Available choices */
  choices: ChoiceOption[];
  /** Minimum number of choices to make */
  minChoices: number;
  /** Maximum number of choices to make */
  maxChoices: number;
  /** Timestamp when this choice was presented */
  presentedAt: number;
  /**
   * `discard_cards` only (#2536): further players who must discard for the
   * same effect, answered one at a time after this one.
   */
  pendingDiscards?: { playerId: PlayerId; amount: number }[];
}

/**
 * An option in a choice
 */
export interface ChoiceOption {
  /** Display text */
  label: string;
  /** Value of this option */
  value: string | number | boolean;
  /** Whether this option is valid */
  isValid: boolean;
}
