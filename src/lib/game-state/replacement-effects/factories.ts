import type { CardInstanceId, PlayerId } from "../types";
import type {
  ReplacementAbility,
  ReplacementEvent,
  PreventionShield,
} from "./types";
// Factory Functions

export function createPreventionShield(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  targetId: string | PlayerId,
  amount: number,
  description: string,
  duration?: "until_end_of_turn" | "until_end_of_next_turn" | "permanent",
  damageTypes?: string[],
): { ability: ReplacementAbility; shield: PreventionShield } {
  const timestamp = Date.now();
  const ability: ReplacementAbility = {
    id: `prevent-${sourceCardId}-${timestamp}`,
    sourceCardId,
    controllerId,
    effectType: "damage_prevention",
    description,
    layer: 1,
    timestamp,
    duration,
    preventionAmount: amount,
    canApply: (e) =>
      e.type === "damage" &&
      e.targetId === targetId &&
      (!damageTypes ||
        !e.damageTypes ||
        e.damageTypes.some((t) => damageTypes.includes(t))),
    apply: () => ({
      modified: false,
      description: "Prevention shield will apply",
    }),
  };
  const shield: PreventionShield = {
    sourceId: sourceCardId,
    amount,
    damageTypes,
    controllerId,
    expiresAt:
      duration === "until_end_of_turn" ? timestamp + 300000 : undefined,
  };
  return { ability, shield };
}

export function createDamageReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  layer: number = 5,
  isSelfReplacement: boolean = false,
): ReplacementAbility {
  return {
    id: `dmg-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "damage_replacement",
    description,
    layer,
    timestamp: Date.now(),
    isSelfReplacement,
    isInstead: true,
    canApply: (e) => e.type === "damage",
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: replacementFn(e.amount, e) },
      description,
      instead: true,
    }),
  };
}

export function createLifeGainReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean,
): ReplacementAbility {
  return {
    id: `life-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "life_gain_replacement",
    description,
    layer: 5,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (e) =>
      e.type === "life_gain" && (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: replacementFn(e.amount, e) },
      description,
      instead: true,
    }),
  };
}

export function createLifeLossReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean,
): ReplacementAbility {
  return {
    id: `loss-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "life_loss_replacement",
    description,
    layer: 5,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (e) =>
      e.type === "life_loss" && (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: replacementFn(e.amount, e) },
      description,
      instead: true,
    }),
  };
}

export function createDrawReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (amount: number, event: ReplacementEvent) => number,
): ReplacementAbility {
  return {
    id: `draw-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "draw_replacement",
    description,
    layer: 5,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (e) => e.type === "draw_card",
    apply: (e) => ({
      modified: true,
      modifiedEvent: { ...e, amount: replacementFn(e.amount, e) },
      description,
      instead: true,
    }),
  };
}

export function createDestroyReplacementEffect(
  sourceCardId: CardInstanceId,
  controllerId: PlayerId,
  description: string,
  replacementFn: (event: ReplacementEvent) => ReplacementEvent | null,
  targetFilter?: (targetId: PlayerId | CardInstanceId | undefined) => boolean,
): ReplacementAbility {
  return {
    id: `destroy-replace-${sourceCardId}-${Date.now()}`,
    sourceCardId,
    controllerId,
    effectType: "destroy_replacement",
    description,
    layer: 3,
    timestamp: Date.now(),
    isInstead: true,
    canApply: (e) =>
      (e.type === "destroy" || e.type === "move_to_graveyard") &&
      (!targetFilter || targetFilter(e.targetId)),
    apply: (e) => {
      const modified = replacementFn(e);
      return modified
        ? {
            modified: true,
            modifiedEvent: modified,
            description,
            instead: true,
          }
        : { modified: false, description: "Cannot apply" };
    },
  };
}
