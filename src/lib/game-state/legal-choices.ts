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
 * Not covered yet (listed as the plain cast, or skipped): X spells (skipped),
 * modal mode selection, kicker and alternative costs, casting from zones
 * other than hand, and targeted loyalty abilities (skipped). Those land in
 * later slices of #2612.
 */
import type { CardInstanceId, GameState, PlayerId, Target } from "./types";
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
import { passPriority } from "./game-state";

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
  return targetCombinations(slots).map((targets) => ({
    kind: "cast_spell" as const,
    cardId,
    targets,
  }));
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
  const landOk = canPlayLand(state, playerId);
  for (const cardId of zoneCards(state, playerId, "hand")) {
    if (isLandCard(state, cardId)) {
      if (landOk) choices.push({ kind: "play_land", cardId });
      continue;
    }
    choices.push(...spellChoices(state, playerId, cardId));
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
