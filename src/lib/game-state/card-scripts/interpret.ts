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
} from "../types";
import {
  resolveCardDrawEffect,
  resolveCounterEffect,
  resolveEffect,
  resolveLifeGainEffect,
  resolveLifeLossEffect,
  resolveStackObjectEffects,
  resolveTokenCreationEffect,
} from "../effect-resolution";
import { destroyCard, exileCard } from "../keyword-actions/removal";
import { addCounters } from "../card-instance";
import { copySpellOnStack } from "../spell-casting/resolve";
import { getCardScript } from "./registry";
import {
  isPermanentScript,
  isTargetedEffect,
  scriptedAbilityEffects,
  scriptedSpellEffects,
} from "./script-guards";
import type {
  CardEffect,
  CardScript,
  ScriptedActivated,
  ScriptedTrigger,
} from "./schema";

interface EffectContext {
  controllerId: PlayerId;
  sourceId?: CardInstanceId;
  target?: Target;
  kickerBonus: number;
  /** Cast triggers: the spell that triggered the ability. */
  triggeringStackObjectId?: string;
}

/**
 * CR 707.10: copy the spell that triggered this ability, keeping its
 * targets. "Those spells gain ..." marks the original and the copy. Does
 * nothing when the spell has left the stack (countered or resolved).
 */
function copyTriggeringSpell(
  state: GameState,
  gain: readonly string[],
  ctx: EffectContext,
): GameState {
  const spellId = ctx.triggeringStackObjectId;
  if (!spellId || !state.stack.some((o) => o.id === spellId)) return state;
  const r = copySpellOnStack(state, spellId);
  if (!r.success || !r.copiedStackObjectId) return state;
  if (gain.length === 0) return r.state;
  const marked = new Set([spellId, r.copiedStackObjectId]);
  return {
    ...r.state,
    stack: r.state.stack.map((o) =>
      marked.has(o.id)
        ? {
            ...o,
            grantedKeywords: [
              ...new Set([...(o.grantedKeywords ?? []), ...gain]),
            ],
          }
        : o,
    ),
  };
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

function opponentsOf(state: GameState, playerId: PlayerId): PlayerId[] {
  return [...state.players.keys()].filter((p) => p !== playerId);
}

function damagePlayer(
  state: GameState,
  amount: number,
  playerId: PlayerId,
  ctx: EffectContext,
): GameState {
  const target: Target = { type: "player", targetId: playerId, isValid: true };
  return resolveStackObjectEffects(
    state,
    [
      {
        effectType: "damage",
        amount,
        targetId: playerId,
        isCombatDamage: false,
      },
    ],
    ctx.sourceId,
    [target],
    ctx.kickerBonus,
  );
}

/** The card a creature-affecting effect hits: its target, or its source. */
function creatureFor(
  state: GameState,
  target: "creature" | "self",
  ctx: EffectContext,
): CardInstanceId | undefined {
  const cardId =
    target === "self" ? ctx.sourceId : (ctx.target?.targetId as CardInstanceId);
  if (!cardId || !isOnBattlefield(state, cardId)) return undefined;
  return cardId;
}

function applyEffect(
  state: GameState,
  effect: CardEffect,
  ctx: EffectContext,
): GameState {
  const { sourceId, target } = ctx;
  switch (effect.op) {
    case "DealDamage": {
      if (effect.target === "each_opponent") {
        let next = state;
        for (const opp of opponentsOf(state, ctx.controllerId)) {
          next = damagePlayer(next, effect.amount, opp, ctx);
        }
        return next;
      }
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
      if (effect.who === "each_opponent") {
        let next = state;
        for (const opp of opponentsOf(state, ctx.controllerId)) {
          const r = resolveLifeLossEffect(next, sourceId, effect.amount, opp);
          if (r.success) next = r.state;
        }
        return next;
      }
      const player = playerFor(effect.who, ctx);
      if (!player) return state;
      const r = resolveLifeLossEffect(state, sourceId, effect.amount, player);
      return r.success ? r.state : state;
    }
    case "CreateToken": {
      const subtypes = effect.subtypes.join(" ");
      const keywords = (effect.keywords ?? []).map(
        (k) => k.charAt(0).toUpperCase() + k.slice(1),
      );
      const colors =
        effect.colors ??
        (effect.color && effect.color !== "colorless" ? [effect.color] : []);
      const r = resolveTokenCreationEffect(
        state,
        sourceId,
        {
          name: subtypes,
          type_line: `Token ${effect.artifact ? "Artifact " : ""}Creature — ${subtypes}`,
          power: String(effect.power),
          toughness: String(effect.toughness),
          colors,
          keywords,
          oracle_text: keywords.join(", "),
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
      const cardId = creatureFor(state, effect.target, ctx);
      if (!cardId) return state;
      const r = resolveEffect(
        state,
        {
          effectType: "pt_until_eot",
          power: effect.power,
          toughness: effect.toughness,
          targetId: cardId,
        },
        sourceId,
      );
      return r.success ? r.state : state;
    }
    case "PutCounters": {
      const cardId = creatureFor(state, effect.target, ctx);
      const card = cardId ? state.cards.get(cardId) : undefined;
      if (!cardId || !card) return state;
      const cards = new Map(state.cards);
      cards.set(cardId, addCounters(card, effect.counter, effect.amount));
      return { ...state, cards };
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
    case "CopySpell":
      return copyTriggeringSpell(state, effect.gain ?? [], ctx);
  }
}

type ScriptStackObject = Pick<
  StackObject,
  "controllerId" | "sourceCardId" | "targets"
> &
  Partial<Pick<StackObject, "triggeringStackObjectId" | "chosenModes">>;

/**
 * Apply a list of scripted effects. Targeted effects take the stack object's
 * targets in order; an effect whose target is missing or no longer legal
 * does nothing (CR 608.2b).
 */
export function resolveScriptedEffects(
  state: GameState,
  effects: readonly CardEffect[],
  stackObject: ScriptStackObject,
  kickerBonus: number = 0,
): GameState {
  const targets = stackObject.targets ?? [];
  let current = state;
  let next = 0;
  for (const effect of effects) {
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
      triggeringStackObjectId: stackObject.triggeringStackObjectId,
    });
  }
  return current;
}

/**
 * Resolve a scripted instant or sorcery. A modal spell resolves only the
 * modes on the stack object's `chosenModes`, in printed order (CR 700.2);
 * with none chosen it does nothing.
 */
export function resolveScriptedSpell(
  state: GameState,
  script: CardScript,
  stackObject: ScriptStackObject,
  kickerBonus: number = 0,
): GameState {
  return resolveScriptedEffects(
    state,
    scriptedSpellEffects(script, stackObject.chosenModes ?? []),
    stackObject,
    kickerBonus,
  );
}

const sameText = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The script entry of a triggered or activated ability on the stack, or
 * undefined when its source has no permanent script. Matched by the ability
 * text, which the stack object carries.
 */
export function getScriptedAbility(
  state: GameState,
  stackObject: Pick<
    StackObject,
    "sourceCardId" | "text" | "triggered" | "activated"
  >,
): ScriptedTrigger | ScriptedActivated | undefined {
  if (!stackObject.sourceCardId || !stackObject.text) return undefined;
  const source = state.cards.get(stackObject.sourceCardId as CardInstanceId);
  const script = getCardScript(source?.cardData.name);
  if (!script || !isPermanentScript(script)) return undefined;
  const abilities: readonly (ScriptedTrigger | ScriptedActivated)[] =
    stackObject.triggered ? (script.triggers ?? []) : (script.activated ?? []);
  return abilities.find((a) => sameText(a.text, stackObject.text));
}

/**
 * The scripted effects of a triggered or activated ability on the stack, or
 * undefined when its source has no permanent script. A modal ability gives
 * its chosen modes' effects; with none chosen, none (CR 700.2).
 */
export function getScriptedAbilityEffects(
  state: GameState,
  stackObject: Pick<
    StackObject,
    "sourceCardId" | "text" | "triggered" | "activated"
  > &
    Partial<Pick<StackObject, "chosenModes">>,
): readonly CardEffect[] | undefined {
  const ability = getScriptedAbility(state, stackObject);
  return ability
    ? scriptedAbilityEffects(ability, stackObject.chosenModes ?? [])
    : undefined;
}

/**
 * Resolve a triggered or activated ability from its source's script.
 * Returns undefined when the ability isn't scripted, so the caller falls back
 * to reading its text.
 */
export function resolveScriptedAbility(
  state: GameState,
  stackObject: StackObject,
): GameState | undefined {
  const effects = getScriptedAbilityEffects(state, stackObject);
  if (!effects) return undefined;
  return resolveScriptedEffects(state, effects, stackObject);
}
