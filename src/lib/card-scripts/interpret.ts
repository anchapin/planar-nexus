/**
 * Applies a card script's effects to the game state.
 *
 * Each effect reuses the engine's existing resolution helpers, so a scripted
 * card behaves exactly like the hand-written paths do today; the script only
 * replaces the step of reading oracle text to decide what happens.
 */
import type {
  CardInstanceId,
  GameState,
  PlayerId,
  StackObject,
  Target,
} from "../game-state/types";
import {
  resolveCardDrawEffect,
  resolveCounterEffect,
  resolveEffect,
  resolveLifeGainEffect,
  resolveLifeLossEffect,
  resolveStackObjectEffects,
  resolveTokenCreationEffect,
} from "../game-state/effect-resolution";
import { destroyCard, exileCard } from "../game-state/keyword-actions/removal";
import { isTargetedEffect, type CardEffect, type CardScript } from "./schema";

interface EffectContext {
  controllerId: PlayerId;
  sourceId?: CardInstanceId;
  target?: Target;
  kickerBonus: number;
}

function isOnBattlefield(state: GameState, cardId: string): boolean {
  const card = state.cards.get(cardId as CardInstanceId);
  if (!card) return false;
  return (
    state.zones
      .get(`${card.controllerId}-battlefield`)
      ?.cardIds.includes(cardId as CardInstanceId) ?? false
  );
}

/** CR 608.2b: a target that is no longer legal is not affected. */
function targetStillLegal(state: GameState, target: Target): boolean {
  if (target.type === "card") return isOnBattlefield(state, target.targetId);
  if (target.type === "player")
    return state.players.has(target.targetId as PlayerId);
  if (target.type === "stack")
    return state.stack.some((o) => o.id === target.targetId);
  return false;
}

function playerFor(
  who: "you" | "target_player",
  ctx: EffectContext,
): PlayerId | undefined {
  if (who === "you") return ctx.controllerId;
  return ctx.target?.type === "player"
    ? (ctx.target.targetId as PlayerId)
    : undefined;
}

function applyEffect(
  state: GameState,
  effect: CardEffect,
  ctx: EffectContext,
): GameState {
  const { sourceId, target } = ctx;
  switch (effect.op) {
    case "DealDamage": {
      if (!target) return state;
      return resolveStackObjectEffects(
        state,
        [
          {
            effectType: "damage",
            amount: effect.amount,
            targetId: target.targetId as CardInstanceId | PlayerId,
            isCombatDamage: false,
          },
        ],
        sourceId,
        [target],
        ctx.kickerBonus,
      );
    }
    case "Draw": {
      const player = playerFor(effect.who, ctx);
      if (!player) return state;
      const r = resolveCardDrawEffect(
        state,
        sourceId ?? ("unknown" as CardInstanceId),
        effect.amount,
        player,
      );
      return r.success ? r.state : state;
    }
    case "GainLife": {
      const player = playerFor(effect.who, ctx);
      if (!player) return state;
      const r = resolveLifeGainEffect(state, sourceId, effect.amount, player);
      return r.success ? r.state : state;
    }
    case "LoseLife": {
      const player = playerFor(effect.who, ctx);
      if (!player) return state;
      const r = resolveLifeLossEffect(state, sourceId, effect.amount, player);
      return r.success ? r.state : state;
    }
    case "CreateToken": {
      const subtypes = effect.subtypes.join(" ");
      const r = resolveTokenCreationEffect(
        state,
        sourceId,
        {
          name: subtypes,
          type_line: `Token Creature — ${subtypes}`,
          power: String(effect.power),
          toughness: String(effect.toughness),
          colors: effect.color === "colorless" ? [] : [effect.color],
        },
        effect.count,
        ctx.controllerId,
      );
      return r.success ? r.state : state;
    }
    case "Destroy": {
      if (!target) return state;
      const r = destroyCard(state, target.targetId as CardInstanceId);
      return r.success ? r.state : state;
    }
    case "Exile": {
      if (!target) return state;
      const r = exileCard(state, target.targetId as CardInstanceId);
      return r.success ? r.state : state;
    }
    case "Counter": {
      if (!target) return state;
      const r = resolveCounterEffect(state, sourceId, target.targetId);
      return r.success ? r.state : state;
    }
    case "Pump": {
      if (!target) return state;
      const r = resolveEffect(
        state,
        {
          effectType: "pt_until_eot",
          power: effect.power,
          toughness: effect.toughness,
          targetId: target.targetId as CardInstanceId,
        },
        sourceId,
      );
      return r.success ? r.state : state;
    }
    case "Surveil": {
      const r = resolveEffect(
        state,
        {
          effectType: "surveil",
          amount: effect.amount,
          targetId: ctx.controllerId,
        },
        sourceId,
      );
      return r.success ? r.state : state;
    }
  }
}

/**
 * Resolve a scripted instant or sorcery. Targeted effects take the stack
 * object's targets in order; an effect whose target is missing or no longer
 * legal does nothing (CR 608.2b).
 */
export function resolveScriptedSpell(
  state: GameState,
  script: CardScript,
  stackObject: Pick<StackObject, "controllerId" | "sourceCardId" | "targets">,
  kickerBonus: number = 0,
): GameState {
  const targets = stackObject.targets ?? [];
  let current = state;
  let next = 0;
  for (const effect of script.spell) {
    let target: Target | undefined;
    if (isTargetedEffect(effect)) {
      target = targets[next++];
      if (!target || !targetStillLegal(current, target)) continue;
    }
    current = applyEffect(current, effect, {
      controllerId: stackObject.controllerId as PlayerId,
      sourceId: (stackObject.sourceCardId as CardInstanceId) || undefined,
      target,
      kickerBonus,
    });
  }
  return current;
}
