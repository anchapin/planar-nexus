/**
 * Legal choices at a priority decision (#2612, manamind self-play epic).
 *
 * `listPriorityChoices` enumerates what `playerId` may do right now when they
 * hold priority: pass, play a land, cast a spell from hand (one choice per
 * legal target combination), activate a non-mana ability of a permanent, or
 * activate a planeswalker loyalty ability. Every listed choice carries enough
 * to apply it with `applyPriorityChoice`, which taps lands for any mana cost
 * and then calls the same engine entry point the UI and AI use.
 *
 * Mana is counted as the pool plus what untapped lands can produce
 * (`tapLandsForCost`), so a spell is listed only when it can be paid now.
 *
 * Combat is listed per creature: `listAttackerOptions` gives each creature
 * that can attack and the defenders it may attack (opponents and their
 * planeswalkers); `listBlockerOptions` gives each creature that can block
 * and the attackers it may block. A declaration is a set of those picks,
 * applied with `applyAttackDeclaration` / `applyBlockDeclaration`, which
 * call `declareAttackers` / `declareBlockers` and so enforce the
 * whole-declaration rules (menace's two-blocker minimum, for example).
 *
 * Mid-game decisions: `getPendingDecision` says who must answer what before
 * play continues (an open `waitingChoice`, such as a discard, an offer or a
 * mode pick, or a triggered ability on the stack still needing a target).
 * `listDecisionAnswers` enumerates the legal answers and
 * `applyDecisionAnswer` applies one through `resolveWaitingChoice` /
 * `chooseTriggerTargets`.
 *
 * Not covered yet (listed as the plain cast, or skipped): X spells (skipped),
 * modal mode selection, kicker and alternative costs, casting from zones
 * other than hand, and targeted loyalty abilities (skipped). Those land in
 * later slices of #2612.
 */
import type { CardInstanceId, GameState, PlayerId, Target } from "./types";
import { canPlayLandsFromGraveyard } from "./mana/land-rules";
import { isPriorityPlayer } from "./priority-guard";
import { canPlayLand, playLand } from "./mana/lands";
import { castSpell, canCastSpell } from "./spell-casting/cast";
import {
  activateAbility,
  getActivatableAbilities,
} from "./abilities/activated";
import {
  activateLoyaltyAbility,
  canActivateLoyaltyAbility,
  getLoyaltyAbilities,
} from "./abilities/loyalty";
import {
  getLegalActivatedAbilityTargets,
  getLegalSpellTargetsAt,
  getSpellTargetSpecs,
  parseTriggerTargetSpec,
} from "./trigger-system/trigger-targets";
import { tapLandsForCost } from "./keyword-actions/hand-activations";
import { isAuraCard, validateAuraSpellTarget } from "./keyword-actions/enchant";
import { passPriority } from "./game-state";
import {
  canAttack,
  canBlock,
  getAvailableAttackers,
  getAvailableBlockers,
} from "./combat/queries";
import { declareAttackers, declareBlockers } from "./combat/declaration";
import { Phase } from "./types";
import type { StackObject } from "./types";
import { resolveWaitingChoice } from "./spell-casting/choices";
import {
  chooseTriggerTargets,
  getLegalTriggerTargets,
  triggerNeedsTargets,
} from "./trigger-system/trigger-targets";

/** Cap on target combinations listed for one multi-target spell. */
export const MAX_TARGET_COMBINATIONS = 64;

export type PriorityChoice =
  | { kind: "pass" }
  | { kind: "play_land"; cardId: CardInstanceId }
  | { kind: "cast_spell"; cardId: CardInstanceId; targets: string[] }
  | {
      kind: "activate_ability";
      cardId: CardInstanceId;
      abilityIndex: number;
      targets: string[];
    }
  | {
      kind: "activate_loyalty";
      cardId: CardInstanceId;
      abilityIndex: number;
    };

function zoneCards(
  state: GameState,
  playerId: PlayerId,
  zone: string,
): CardInstanceId[] {
  return [...(state.zones.get(`${playerId}-${zone}`)?.cardIds ?? [])];
}

function isLandCard(state: GameState, cardId: CardInstanceId): boolean {
  const typeLine = state.cards.get(cardId)?.cardData.type_line ?? "";
  return /\bland\b/i.test(typeLine.split("//")[0]);
}

function spellManaCost(state: GameState, cardId: CardInstanceId): string {
  const data = state.cards.get(cardId)?.cardData;
  if (!data) return "";
  return data.mana_cost ?? data.card_faces?.[0]?.mana_cost ?? "";
}

/** Mana symbols in an activated ability's cost ("{2}{R}, {T}: ..."). */
function abilityManaCost(label: string): string {
  const cost = label.split(":")[0] ?? "";
  return (cost.match(/\{[^}]+\}/g) ?? [])
    .filter((s) => s !== "{T}" && s !== "{Q}")
    .join("");
}

/** True when the pool plus untapped lands can pay `cost`. */
function canPay(state: GameState, playerId: PlayerId, cost: string): boolean {
  return !cost || tapLandsForCost(state, playerId, cost) !== null;
}

/** Distinct-target combinations, one list per target slot, capped. */
function targetCombinations(slots: string[][]): string[][] {
  let combos: string[][] = [[]];
  for (const options of slots) {
    const next: string[][] = [];
    for (const combo of combos) {
      for (const id of options) {
        if (combo.includes(id)) continue;
        next.push([...combo, id]);
        if (next.length >= MAX_TARGET_COMBINATIONS) break;
      }
      if (next.length >= MAX_TARGET_COMBINATIONS) break;
    }
    combos = next;
    if (combos.length === 0) return [];
  }
  return combos;
}

function spellChoices(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): PriorityChoice[] {
  if (!canCastSpell(state, playerId, cardId).canCast) return [];
  const cost = spellManaCost(state, cardId);
  if (/\{X\}/i.test(cost)) return [];
  if (!canPay(state, playerId, cost)) return [];
  const specs = getSpellTargetSpecs(state, cardId);
  const slots = specs.map((_, i) =>
    getLegalSpellTargetsAt(state, playerId, cardId, i),
  );
  // CR 303.4a: an Aura spell targets what it will enchant. Its "Enchant ..."
  // line is not a spell effect, so it has no target slot above (#2614).
  if (slots.length === 0) {
    const aura = auraTargets(state, playerId, cardId);
    if (aura) slots.push(aura);
  }
  return targetCombinations(slots).map((targets) => ({
    kind: "cast_spell" as const,
    cardId,
    targets,
  }));
}

/** Legal "enchant" targets for an Aura spell, or null for a non-Aura. */
function auraTargets(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): string[] | null {
  const aura = state.cards.get(cardId);
  if (!aura || !isAuraCard(aura)) return null;
  // No restriction we can read (or bestow handled elsewhere): cast untargeted.
  if (validateAuraSpellTarget(state, aura, playerId, undefined).valid) {
    return null;
  }
  const ids: string[] = [];
  for (const [zoneKey, zone] of state.zones) {
    if (!zoneKey.endsWith("-battlefield")) continue;
    for (const id of zone.cardIds) {
      if (validateAuraSpellTarget(state, aura, playerId, id).valid) {
        ids.push(id);
      }
    }
  }
  return ids;
}

function abilityChoices(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): PriorityChoice[] {
  const out: PriorityChoice[] = [];
  for (const ability of getActivatableAbilities(state, playerId, cardId)) {
    if (!canPay(state, playerId, abilityManaCost(ability.label))) continue;
    const needsTarget = parseTriggerTargetSpec(ability.effect) !== null;
    const legal = needsTarget
      ? getLegalActivatedAbilityTargets(
          state,
          playerId,
          cardId,
          ability.abilityIndex,
        )
      : [];
    if (needsTarget && legal.length === 0) continue;
    const combos = needsTarget ? legal.map((id) => [id]) : [[]];
    for (const targets of combos) {
      out.push({
        kind: "activate_ability",
        cardId,
        abilityIndex: ability.abilityIndex,
        targets,
      });
    }
  }
  return out;
}

function loyaltyChoices(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): PriorityChoice[] {
  const card = state.cards.get(cardId);
  if (!card) return [];
  const out: PriorityChoice[] = [];
  getLoyaltyAbilities(card.cardData).forEach((ability, abilityIndex) => {
    if (parseTriggerTargetSpec(ability.effect) !== null) return;
    if (
      canActivateLoyaltyAbility(state, playerId, cardId, ability.cost)
        .canActivate
    ) {
      out.push({ kind: "activate_loyalty", cardId, abilityIndex });
    }
  });
  return out;
}

/**
 * Everything `playerId` may do at this priority decision. Empty when they
 * don't hold priority; otherwise always starts with `pass`.
 */
export function listPriorityChoices(
  state: GameState,
  playerId: PlayerId,
): PriorityChoice[] {
  if (!isPriorityPlayer(state, playerId)) return [];
  const choices: PriorityChoice[] = [{ kind: "pass" }];
  // playLand also requires it to be the player's own turn (canPlayLand
  // checks timing and land drops but not whose turn it is).
  const landOk =
    state.turn.activePlayerId === playerId && canPlayLand(state, playerId);
  for (const cardId of zoneCards(state, playerId, "hand")) {
    if (isLandCard(state, cardId)) {
      if (landOk) choices.push({ kind: "play_land", cardId });
      continue;
    }
    choices.push(...spellChoices(state, playerId, cardId));
  }
  // "You may play lands from your graveyard" (#2614 Icetill Explorer).
  if (landOk && canPlayLandsFromGraveyard(state, playerId)) {
    for (const cardId of zoneCards(state, playerId, "graveyard")) {
      if (isLandCard(state, cardId)) {
        choices.push({ kind: "play_land", cardId });
      }
    }
  }
  for (const cardId of zoneCards(state, playerId, "battlefield")) {
    if (state.cards.get(cardId)?.controllerId !== playerId) continue;
    choices.push(...abilityChoices(state, playerId, cardId));
    choices.push(...loyaltyChoices(state, playerId, cardId));
  }
  return choices;
}

function toTargets(state: GameState, ids: string[]): Target[] {
  return ids.map((targetId) => ({
    type: state.players.has(targetId as PlayerId) ? "player" : "card",
    targetId,
    isValid: true,
  }));
}

export interface ApplyChoiceResult {
  success: boolean;
  state: GameState;
  error?: string;
}

/**
 * Apply a choice from `listPriorityChoices`, tapping lands for its mana cost
 * first. The original state is untouched on failure.
 */
export function applyPriorityChoice(
  state: GameState,
  playerId: PlayerId,
  choice: PriorityChoice,
): ApplyChoiceResult {
  switch (choice.kind) {
    case "pass":
      return { success: true, state: passPriority(state, playerId) };
    case "play_land": {
      const r = playLand(state, playerId, choice.cardId);
      return { success: r.success, state: r.state, error: r.error };
    }
    case "cast_spell": {
      const paid = tapLandsForCost(
        state,
        playerId,
        spellManaCost(state, choice.cardId),
      );
      if (!paid) return { success: false, state, error: "Can't pay cost" };
      const r = castSpell(
        paid,
        playerId,
        choice.cardId,
        toTargets(paid, choice.targets),
      );
      return r.success
        ? { success: true, state: r.state }
        : { success: false, state, error: r.error };
    }
    case "activate_ability": {
      const ability = getActivatableAbilities(
        state,
        playerId,
        choice.cardId,
      ).find((a) => a.abilityIndex === choice.abilityIndex);
      if (!ability)
        return { success: false, state, error: "Ability not available" };
      const paid = tapLandsForCost(
        state,
        playerId,
        abilityManaCost(ability.label),
      );
      if (!paid) return { success: false, state, error: "Can't pay cost" };
      const r = activateAbility(
        paid,
        playerId,
        choice.cardId,
        choice.abilityIndex,
        toTargets(paid, choice.targets),
      );
      return r.success
        ? { success: true, state: r.state }
        : { success: false, state, error: r.error };
    }
    case "activate_loyalty": {
      const r = activateLoyaltyAbility(
        state,
        playerId,
        choice.cardId,
        choice.abilityIndex,
      );
      return r.success
        ? { success: true, state: r.state }
        : { success: false, state, error: r.error };
    }
  }
}

/** A creature that can attack, with every defender it may attack. */
export interface AttackerOption {
  cardId: CardInstanceId;
  defenders: (PlayerId | CardInstanceId)[];
}

/** A creature that can block, with every attacker it may block. */
export interface BlockerOption {
  cardId: CardInstanceId;
  attackers: CardInstanceId[];
}

export interface AttackAssignment {
  cardId: CardInstanceId;
  defenderId: PlayerId | CardInstanceId;
}

export interface BlockAssignment {
  blockerId: CardInstanceId;
  attackerId: CardInstanceId;
}

function isPlaneswalkerCard(state: GameState, cardId: CardInstanceId) {
  const typeLine = state.cards.get(cardId)?.cardData.type_line ?? "";
  return /\bplaneswalker\b/i.test(typeLine);
}

/** Players and planeswalkers `playerId` may attack. */
function possibleDefenders(
  state: GameState,
  playerId: PlayerId,
): (PlayerId | CardInstanceId)[] {
  const out: (PlayerId | CardInstanceId)[] = [];
  for (const opponentId of state.players.keys()) {
    if (opponentId === playerId) continue;
    out.push(opponentId);
    for (const cardId of zoneCards(state, opponentId, "battlefield")) {
      if (isPlaneswalkerCard(state, cardId)) out.push(cardId);
    }
  }
  return out;
}

/**
 * Creatures the active player may attack with, each with its legal
 * defenders. Empty outside their beginning of combat / declare attackers
 * step, or once attackers are declared.
 */
export function listAttackerOptions(
  state: GameState,
  playerId: PlayerId,
): AttackerOption[] {
  if (state.turn.activePlayerId !== playerId) return [];
  const phase = state.turn.currentPhase;
  if (phase !== Phase.BEGIN_COMBAT && phase !== Phase.DECLARE_ATTACKERS) {
    return [];
  }
  if (state.combat.attackers.length > 0) return [];
  const defenders = possibleDefenders(state, playerId);
  const out: AttackerOption[] = [];
  for (const cardId of getAvailableAttackers(state, playerId)) {
    const legal = defenders.filter(
      (d) => canAttack(state, cardId, d).canAttack,
    );
    if (legal.length > 0) out.push({ cardId, defenders: legal });
  }
  return out;
}

/** True when `attackerId` is attacking `playerId` or one of their walkers. */
function attacksPlayer(
  state: GameState,
  defenderId: PlayerId | CardInstanceId,
  playerId: PlayerId,
): boolean {
  if (defenderId === playerId) return true;
  return (
    state.cards.get(defenderId as CardInstanceId)?.controllerId === playerId
  );
}

/**
 * Creatures `playerId` may block with, each with the attackers it may
 * block. Empty when nothing is attacking them.
 */
export function listBlockerOptions(
  state: GameState,
  playerId: PlayerId,
): BlockerOption[] {
  if (!state.combat.inCombatPhase) return [];
  const attackers = state.combat.attackers
    .filter((a) => attacksPlayer(state, a.defenderId, playerId))
    .map((a) => a.cardId);
  if (attackers.length === 0) return [];
  const out: BlockerOption[] = [];
  for (const cardId of getAvailableBlockers(state, playerId)) {
    if (state.cards.get(cardId)?.controllerId !== playerId) continue;
    const legal = attackers.filter((a) => canBlock(state, cardId, a).canBlock);
    if (legal.length > 0) out.push({ cardId, attackers: legal });
  }
  return out;
}

/**
 * Declare attackers. An empty list is a legal "no attack" and leaves the
 * state as it is.
 */
export function applyAttackDeclaration(
  state: GameState,
  assignments: AttackAssignment[],
): ApplyChoiceResult {
  if (assignments.length === 0) return { success: true, state };
  const r = declareAttackers(state, assignments);
  if (!r.success || (r.errors && r.errors.length > 0)) {
    return { success: false, state, error: r.errors?.join("; ") };
  }
  return { success: true, state: r.state };
}

/**
 * Declare blockers. An empty list is a legal "no blocks" and leaves the
 * state as it is.
 */
export function applyBlockDeclaration(
  state: GameState,
  assignments: BlockAssignment[],
): ApplyChoiceResult {
  if (assignments.length === 0) return { success: true, state };
  const byAttacker = new Map<CardInstanceId, CardInstanceId[]>();
  for (const { blockerId, attackerId } of assignments) {
    byAttacker.set(attackerId, [
      ...(byAttacker.get(attackerId) ?? []),
      blockerId,
    ]);
  }
  const r = declareBlockers(state, byAttacker);
  if (!r.success || (r.errors && r.errors.length > 0)) {
    return { success: false, state, error: r.errors?.join("; ") };
  }
  return { success: true, state: r.state };
}

/** Cap on answers listed for one multi-pick decision (a discard of 3). */
export const MAX_DECISION_ANSWERS = 64;

export type PendingDecision =
  | {
      kind: "waiting_choice";
      playerId: PlayerId;
      choiceType: string;
      minChoices: number;
      maxChoices: number;
    }
  | { kind: "trigger_targets"; playerId: PlayerId; stackObjectId: string };

export type DecisionAnswer =
  | { kind: "waiting_choice"; value: string | number | boolean | string[] }
  | { kind: "trigger_targets"; stackObjectId: string; targets: string[] };

function triggerAwaitingTargets(state: GameState): StackObject | undefined {
  return [...state.stack]
    .reverse()
    .find((obj) => triggerNeedsTargets(obj, state));
}

/**
 * The decision that must be answered before priority or combat continues,
 * or null when there is none.
 */
export function getPendingDecision(state: GameState): PendingDecision | null {
  const choice = state.waitingChoice;
  if (choice) {
    return {
      kind: "waiting_choice",
      playerId: choice.playerId,
      choiceType: choice.type,
      minChoices: choice.minChoices,
      maxChoices: choice.maxChoices,
    };
  }
  const trigger = triggerAwaitingTargets(state);
  if (trigger) {
    return {
      kind: "trigger_targets",
      playerId: trigger.controllerId,
      stackObjectId: trigger.id,
    };
  }
  return null;
}

/** Every size-`k` subset of `items`, in order, capped. */
function subsets<T>(items: T[], k: number, cap: number): T[][] {
  const out: T[][] = [];
  const pick = (start: number, acc: T[]) => {
    if (out.length >= cap) return;
    if (acc.length === k) {
      out.push(acc);
      return;
    }
    for (let i = start; i < items.length; i++) pick(i + 1, [...acc, items[i]]);
  };
  pick(0, []);
  return out;
}

/** Waiting-choice types answered with a list of option values. */
const LIST_ANSWER_TYPES = new Set([
  "discard_to_hand_size",
  "discard_cards",
  "choose_mode",
]);

/**
 * Legal answers to the pending decision for `playerId`. Empty when nothing
 * is pending for them. Multi-pick answers (discard two) are listed as every
 * combination of the required size, capped at MAX_DECISION_ANSWERS.
 */
export function listDecisionAnswers(
  state: GameState,
  playerId: PlayerId,
): DecisionAnswer[] {
  const pending = getPendingDecision(state);
  if (!pending || pending.playerId !== playerId) return [];

  if (pending.kind === "trigger_targets") {
    const ids = getLegalTriggerTargets(
      state,
      state.stack.find((o) => o.id === pending.stackObjectId)!,
    );
    const answers: DecisionAnswer[] = ids.map((id) => ({
      kind: "trigger_targets",
      stackObjectId: pending.stackObjectId,
      targets: [id],
    }));
    // "Up to one" abilities may also choose no target.
    if (chooseTriggerTargets(state, pending.stackObjectId, []).success) {
      answers.push({
        kind: "trigger_targets",
        stackObjectId: pending.stackObjectId,
        targets: [],
      });
    }
    return answers;
  }

  const choice = state.waitingChoice!;
  const values = choice.choices.filter((c) => c.isValid).map((c) => c.value);
  const multi =
    LIST_ANSWER_TYPES.has(choice.type) &&
    (choice.type !== "choose_mode" || choice.maxChoices > 1);
  if (!multi) {
    return values.map((value) => ({ kind: "waiting_choice", value }));
  }
  const ids = values.filter((v): v is string => typeof v === "string");
  const out: DecisionAnswer[] = [];
  const lo = Math.max(choice.minChoices, 0);
  const hi = Math.min(choice.maxChoices, ids.length);
  for (let k = lo; k <= hi && out.length < MAX_DECISION_ANSWERS; k++) {
    for (const pick of subsets(ids, k, MAX_DECISION_ANSWERS - out.length)) {
      out.push({ kind: "waiting_choice", value: pick });
    }
  }
  return out;
}

/** Apply an answer from `listDecisionAnswers`. */
export function applyDecisionAnswer(
  state: GameState,
  playerId: PlayerId,
  answer: DecisionAnswer,
): ApplyChoiceResult {
  if (answer.kind === "trigger_targets") {
    const obj = state.stack.find((o) => o.id === answer.stackObjectId);
    if (!obj || obj.controllerId !== playerId) {
      return { success: false, state, error: "Not this player's trigger" };
    }
    const r = chooseTriggerTargets(state, answer.stackObjectId, answer.targets);
    return r.success
      ? { success: true, state: r.state }
      : { success: false, state, error: r.error };
  }
  const r = resolveWaitingChoice(state, playerId, answer.value);
  return r.success
    ? { success: true, state: r.state }
    : { success: false, state, error: r.error };
}
