import { isSelfTransformText } from "../keyword-actions/transform";
import type {
  GameState,
  PlayerId,
  CardInstanceId,
  StackObject,
} from "../types";
import { Phase } from "../types";
import { isPriorityPlayer } from "../priority-guard";
import { hasSplitSecondOnStack } from "../auto-pass-priority";
import { isManaAbility, spendMana, addMana } from "../mana";
import { parseManaFromEffect } from "./mana";
import { destroyCard, discardCards } from "../keyword-actions";
import {
  findNamedCardInHand,
  getDiscardNamedCost,
  isRevealUntilInstantOrSorceryText,
} from "../keyword-actions/grandeur";
import { getActivatedAbilities } from "./parse";
import { isCreature } from "../card-instance";
import { hasKeyword } from "../evergreen-keywords";
import { generateAbilityId } from "./ids";
import { evaluateInterveningIfClause } from "./evaluate";
import {
  getActivationCondition,
  isActivateOnlyOnce,
} from "../keyword-actions/threshold";
import {
  parseTriggerTargetSpec,
  getLegalActivatedAbilityTargets,
} from "../trigger-system/trigger-targets";
import type { ActivateAbilityResult } from "./types";

/**
 * Sorcery timing (CR 307.1): your turn, a main phase, an empty stack, and
 * priority. Kept local so this module doesn't pull equip into the client
 * bundle.
 */
function atSorcerySpeed(state: GameState, playerId: PlayerId): boolean {
  const phase = state.turn.currentPhase;
  return (
    state.turn.activePlayerId === playerId &&
    (phase === Phase.PRECOMBAT_MAIN || phase === Phase.POSTCOMBAT_MAIN) &&
    state.stack.length === 0 &&
    isPriorityPlayer(state, playerId)
  );
}

/** Whether a once-each-turn ability was already activated this turn. */
function usedThisTurn(
  state: GameState,
  card: { activatedThisTurn?: { turn: number; abilities: number[] } },
  abilityIndex: number,
): boolean {
  const used = card.activatedThisTurn;
  return (
    !!used &&
    used.turn === state.turn.turnNumber &&
    used.abilities.includes(abilityIndex)
  );
}

export function canActivateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
): { canActivate: boolean; reason?: string } {
  const card = state.cards.get(cardId);
  if (!card) {
    return { canActivate: false, reason: "Card not found" };
  }

  if (card.controllerId !== playerId) {
    return { canActivate: false, reason: "You do not control this card" };
  }

  if (!isPriorityPlayer(state, playerId)) {
    return { canActivate: false, reason: "You do not have priority" };
  }

  const battlefieldZone = state.zones.get(`${playerId}-battlefield`);
  if (!battlefieldZone || !battlefieldZone.cardIds.includes(cardId)) {
    return { canActivate: false, reason: "Card is not on the battlefield" };
  }

  const abilities = getActivatedAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (ability && hasSplitSecondOnStack(state)) {
    if (!isManaAbility(cardId, ability.effect)) {
      return {
        canActivate: false,
        reason:
          "A spell with split second is on the stack. Only mana abilities may be activated.",
      };
    }
  }

  // CR 302.6: a creature's {T} ability can't be activated unless it's been
  // under its controller's control since their most recent turn began
  // (haste waives this, CR 702.10).
  if (
    ability &&
    ability.costs.tap &&
    card.hasSummoningSickness &&
    isCreature(card) &&
    !hasKeyword(card, "haste")
  ) {
    return {
      canActivate: false,
      reason: "This creature has summoning sickness",
    };
  }

  // CR 602.5b: "Activate only if <condition>" (threshold's Thought Shucker
  // and Loot, the Anomaly, issue #2300).
  const condition = ability
    ? getActivationCondition(card, ability.effect ?? "")
    : null;
  if (condition && !evaluateInterveningIfClause(condition, state, playerId)) {
    return {
      canActivate: false,
      reason: `Activate only if ${condition}`,
    };
  }

  // CR 602.5b: "Activate only once" (Thought Shucker, issue #2482).
  if (
    ability &&
    card.activatedOnceAbilities?.includes(abilityIndex) &&
    (ability.activationLimit === "once" ||
      isActivateOnlyOnce(card, ability.effect ?? ""))
  ) {
    return {
      canActivate: false,
      reason: "This ability can be activated only once",
    };
  }

  // CR 602.5b: "Activate only once each turn" (issue #2496).
  if (
    ability?.activationLimit === "oncePerTurn" &&
    usedThisTurn(state, card, abilityIndex)
  ) {
    return {
      canActivate: false,
      reason: "This ability can be activated only once each turn",
    };
  }

  // CR 602.5d: "Activate only as a sorcery" (issue #2496).
  if (ability?.sorceryOnly && !atSorcerySpeed(state, playerId)) {
    return {
      canActivate: false,
      reason: "Activate only as a sorcery",
    };
  }

  // Grandeur (issue #2300): "discard another card named X" needs that card.
  const namedDiscard = ability
    ? getDiscardNamedCost(ability.costs.additionalCosts)
    : null;
  if (
    namedDiscard &&
    !findNamedCardInHand(state, playerId, namedDiscard, cardId)
  ) {
    return {
      canActivate: false,
      reason: `You need another card named ${namedDiscard} in hand`,
    };
  }

  return { canActivate: true };
}

/** A non-mana activated ability the player can activate right now. */
export interface ActivatableAbility {
  abilityIndex: number;
  /** The ability's line of oracle text ("cost: effect") when found. */
  label: string;
  effect: string;
}

/**
 * Non-mana activated abilities of a permanent that `playerId` can activate
 * now (priority, timing, summoning sickness). Mana abilities are excluded;
 * they go through the mana flow.
 */
export function getActivatableAbilities(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): ActivatableAbility[] {
  const card = state.cards.get(cardId);
  if (!card) return [];
  const lines = (card.cardData.oracle_text ?? "")
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.includes(":"));
  const out: ActivatableAbility[] = [];
  getActivatedAbilities(card.cardData).forEach((ability, abilityIndex) => {
    const effect = ability.effect ?? "";
    if (isManaAbility(cardId, effect)) return;
    if (
      !canActivateAbility(state, playerId, cardId, abilityIndex).canActivate
    ) {
      return;
    }
    const key = effect.toLowerCase().slice(0, 24);
    const label =
      (key && lines.find((l) => l.toLowerCase().includes(key))) || effect;
    out.push({ abilityIndex, label, effect });
  });
  return out;
}

export function activateAbility(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
  targets: { type: string; targetId: string }[] = [],
): ActivateAbilityResult {
  const card = state.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: "Card not found",
    };
  }

  const canActivate = canActivateAbility(state, playerId, cardId, abilityIndex);
  if (!canActivate.canActivate) {
    return {
      success: false,
      state,
      description: "",
      error: canActivate.reason,
    };
  }

  const abilities = getActivatedAbilities(card.cardData);
  const ability = abilities[abilityIndex];

  if (!ability) {
    return {
      success: false,
      state,
      description: "",
      error: "Ability not found",
    };
  }
  // "Add one mana of any color" needs a color choice, which goes through
  // activateManaAbility (a Treasure, #2544). Refuse here before any cost is
  // paid, so the source isn't sacrificed for no mana.
  if (
    isManaAbility(cardId, ability.effect) &&
    /any (?:one )?color/i.test(ability.effect) &&
    Object.keys(parseManaFromEffect(ability.effect)).length === 0
  ) {
    return {
      success: false,
      state,
      description: "",
      error: "Choose a color: activate it as a mana ability",
    };
  }

  // CR 602.2b / 601.2c: targets are checked before any cost is paid.
  const targetSpec = isManaAbility(cardId, ability.effect)
    ? null
    : parseTriggerTargetSpec(ability.effect ?? "");
  if (targets.length > 0) {
    if (!targetSpec) {
      return {
        success: false,
        state,
        description: "",
        error: "This ability has no targets",
      };
    }
    if (targets.length > 1) {
      return {
        success: false,
        state,
        description: "",
        error: "This ability takes one target",
      };
    }
    const legal = new Set(
      getLegalActivatedAbilityTargets(state, playerId, cardId, abilityIndex),
    );
    const illegal = targets.find((t) => !legal.has(t.targetId));
    if (illegal) {
      return {
        success: false,
        state,
        description: "",
        error: `Illegal target: ${illegal.targetId}`,
      };
    }
  }

  let currentState = state;

  if (ability.costs.tap) {
    const updatedCard = {
      ...card,
      isTapped: true,
    };
    const updatedCards = new Map(currentState.cards);
    updatedCards.set(cardId, updatedCard);
    currentState = {
      ...currentState,
      cards: updatedCards,
    };
  }

  if (ability.costs.mana) {
    const manaCost = ability.costs.mana;
    // CR 107.3, #2559: an X-cost activation ("{X}{G}, {T}: ...") charges the
    // source's chosen X (read from `card.xValue`, set at cast time) as generic
    // mana on top of the printed generic component. An activation without
    // `card.xValue` (e.g. a non-X-cost permanent) treats X as 0 and the
    // printed mana is all that gets spent.
    const xValue =
      typeof manaCost.X === "number" && manaCost.X !== null
        ? (card.xValue ?? 0)
        : 0;
    const manaPayment = {
      generic: manaCost.generic + xValue,
      white: manaCost.white,
      blue: manaCost.blue,
      black: manaCost.black,
      red: manaCost.red,
      green: manaCost.green,
    };
    const manaResult = spendMana(currentState, playerId, manaPayment);
    if (!manaResult.success) {
      return {
        success: false,
        state: currentState,
        description: "",
        error: "Not enough mana",
      };
    }
    currentState = manaResult.state;
  }

  if (ability.costs.payLife > 0) {
    const player = currentState.players.get(playerId);
    if (!player || player.life < ability.costs.payLife) {
      return {
        success: false,
        state: currentState,
        description: "",
        error: "Not enough life",
      };
    }
    const updatedPlayer = {
      ...player,
      life: player.life - ability.costs.payLife,
    };
    const updatedPlayers = new Map(currentState.players);
    updatedPlayers.set(playerId, updatedPlayer);
    currentState = {
      ...currentState,
      players: updatedPlayers,
    };
  }

  if (ability.costs.sacrifice) {
    const result = destroyCard(currentState, cardId, true);
    if (result.success) {
      currentState = result.state;
    }
  }

  const namedDiscardCost = getDiscardNamedCost(ability.costs.additionalCosts);
  if (namedDiscardCost) {
    const discardId = findNamedCardInHand(
      currentState,
      playerId,
      namedDiscardCost,
      cardId,
    );
    if (!discardId) {
      return {
        success: false,
        state,
        description: "",
        error: `You need another card named ${namedDiscardCost} in hand`,
      };
    }
    const result = discardCards(currentState, playerId, 1, false, [discardId]);
    if (result.success) {
      currentState = result.state;
    }
  }

  if (ability.costs.discard) {
    const result = discardCards(currentState, playerId, 1, false);
    if (result.success) {
      currentState = result.state;
    }
  }

  // CR 602.5b: record a once-each-turn activation (issue #2496).
  if (ability.activationLimit === "oncePerTurn") {
    const source = currentState.cards.get(cardId);
    if (source) {
      const turn = currentState.turn.turnNumber;
      const prior =
        source.activatedThisTurn?.turn === turn
          ? source.activatedThisTurn.abilities
          : [];
      const cards = new Map(currentState.cards);
      cards.set(cardId, {
        ...source,
        activatedThisTurn: { turn, abilities: [...prior, abilityIndex] },
      });
      currentState = { ...currentState, cards };
    }
  }

  // CR 602.5b: record a once-only activation on the permanent (issue #2482).
  if (
    ability.activationLimit === "once" ||
    isActivateOnlyOnce(card, ability.effect ?? "")
  ) {
    const source = currentState.cards.get(cardId);
    if (source) {
      const cards = new Map(currentState.cards);
      cards.set(cardId, {
        ...source,
        activatedOnceAbilities: [
          ...(source.activatedOnceAbilities ?? []),
          abilityIndex,
        ],
      });
      currentState = { ...currentState, cards };
    }
  }

  if (isManaAbility(cardId, ability.effect)) {
    const parsedMana = parseManaFromEffect(ability.effect);
    if (Object.keys(parsedMana).length > 0) {
      currentState = addMana(currentState, playerId, parsedMana);
    }

    const updatedPlayers = new Map(currentState.players);
    const player = updatedPlayers.get(playerId);
    if (player) {
      updatedPlayers.set(playerId, {
        ...player,
        hasActivatedManaAbility: true,
      });
    }

    return {
      success: true,
      state: {
        ...currentState,
        players: updatedPlayers,
        lastModifiedAt: Date.now(),
      },
      description: `Activated ${card.cardData.name}'s mana ability`,
    };
  }

  const stackZone = currentState.zones.get("stack");
  if (!stackZone) {
    return {
      success: false,
      state: currentState,
      description: "",
      error: "Stack zone not found",
    };
  }

  const battlefieldZone = currentState.zones.get(`${playerId}-battlefield`);

  let cardMovedState = currentState;
  if (battlefieldZone && battlefieldZone.cardIds.includes(cardId)) {
    const stackObject: StackObject = {
      id: generateAbilityId(),
      type: "ability",
      sourceCardId: cardId,
      controllerId: playerId,
      name: `${card.cardData.name} ability`,
      text: ability.effect,
      // CR 701.28 - "Transform <this>" resolves as a structured effect so
      // it doesn't depend on oracle-text parsing of the whole card.
      ...(isSelfTransformText(ability.effect ?? "", card.cardData.name)
        ? { effects: [{ effectType: "transform" as const, targetId: cardId }] }
        : {}),
      ...(isRevealUntilInstantOrSorceryText(ability.effect ?? "")
        ? {
            effects: [
              {
                effectType: "reveal_until_instant_sorcery" as const,
                targetId: playerId,
              },
            ],
          }
        : {}),
      manaCost: card.cardData.mana_cost ?? null,
      targets: targets.map((t) => ({
        type: t.type as "card" | "player" | "zone",
        targetId: t.targetId,
        isValid: true,
      })),
      chosenModes: [],
      // CR 107.3, #2559. Seed X from the source permanent's `xValue` so an
      // X-cost creature's "{X}, {T}: ..." activation sees the same X the
      // caster chose on cast. Falls back to an empty Map for non-X
      // activations; `resolveScriptedEffects` defaults missing X to 0.
      variableValues:
        typeof card.xValue === "number"
          ? new Map([["X", card.xValue]])
          : new Map(),
      isCountered: false,
      timestamp: Date.now(),
      // CR 602: resolves from its own text; targets picked now or, when the
      // caller passed none, chosen on the stack (see triggerNeedsTargets).
      activated: true,
      ...(targetSpec ? { targetsChosen: targets.length > 0 } : {}),
    };

    const updatedStack = [...cardMovedState.stack, stackObject];

    cardMovedState = {
      ...cardMovedState,
      stack: updatedStack,
      lastModifiedAt: Date.now(),
    };
  }

  const playerIds = Array.from(cardMovedState.players.keys());
  const currentIndex = playerIds.indexOf(playerId);
  const nextIndex = (currentIndex + 1) % playerIds.length;
  const nextPlayerId = playerIds[nextIndex];

  const updatedPlayers = new Map(cardMovedState.players);
  const player = updatedPlayers.get(playerId);
  if (player) {
    updatedPlayers.set(playerId, {
      ...player,
      hasPassedPriority: false,
    });
  }

  return {
    success: true,
    state: {
      ...cardMovedState,
      players: updatedPlayers,
      priorityPlayerId: nextPlayerId,
      consecutivePasses: 0,
      lastModifiedAt: Date.now(),
    },
    description: `Activated ${card.cardData.name}'s ability`,
  };
}
