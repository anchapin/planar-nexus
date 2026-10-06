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
import {
  destroyCard,
  exileCard,
  moveCardToZone,
} from "../keyword-actions/removal";
import { tapCardAction, untapCardAction } from "../keyword-actions/damage-tap";
import { millCards } from "../zones";
import { startDiscard } from "../keyword-actions/discard-choice";
import { addCounters, isCreature } from "../card-instance";
import { getEffectivePower } from "../evergreen-keywords";
import { copySpellOnStack } from "../spell-casting/resolve";
import { getCardScript } from "./registry";
import { PREDEFINED_TOKENS } from "./predefined-tokens";
import {
  matchesController,
  matchesRemovalFilter,
  type RemovalFilter,
  type TargetController,
} from "./target-filters";
import {
  effectTargetCount,
  isPermanentScript,
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
  /**
   * Fight/Bite (#2548): the fighter when it is a target (fighter "creature")
   * or the previous targeted effect's target (fighter "it").
   */
  fighter?: Target;
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
  controller?: TargetController,
): CardInstanceId | undefined {
  const cardId =
    target === "self" ? ctx.sourceId : (ctx.target?.targetId as CardInstanceId);
  if (!cardId || !isOnBattlefield(state, cardId)) return undefined;
  if (
    target === "creature" &&
    !controllerStillMatches(state, cardId, controller, ctx)
  )
    return undefined;
  return cardId;
}

/**
 * A target that changed controller since it was chosen is illegal (CR
 * 608.2b); "you control" is judged against the spell or ability's controller.
 */
function controllerStillMatches(
  state: GameState,
  targetId: string,
  controller: TargetController | undefined,
  ctx: EffectContext,
): boolean {
  if (!controller) return true;
  const card = state.cards.get(targetId as CardInstanceId);
  return (
    Boolean(card) && matchesController(card!, controller, ctx.controllerId)
  );
}

/**
 * Put the top `amount` cards of `playerId`'s library into their graveyard
 * (#2534), keeping each card's zone key in sync.
 */
function millPlayer(
  state: GameState,
  playerId: PlayerId,
  amount: number,
): GameState {
  const libraryKey = `${playerId}-library`;
  const graveyardKey = `${playerId}-graveyard`;
  const library = state.zones.get(libraryKey);
  const graveyard = state.zones.get(graveyardKey);
  if (!library || !graveyard || library.cardIds.length === 0) return state;
  const milled = millCards(library, graveyard, amount);
  const zones = new Map(state.zones);
  zones.set(libraryKey, milled.library);
  zones.set(graveyardKey, milled.graveyard);
  const cards = new Map(state.cards);
  for (const cardId of milled.milledCards) {
    const card = cards.get(cardId);
    if (card) cards.set(cardId, { ...card, currentZoneKey: graveyardKey });
  }
  return { ...state, zones, cards };
}

/** Noncombat damage dealt by one creature to another (#2548). */
function creatureDamage(
  state: GameState,
  fromId: CardInstanceId,
  toId: CardInstanceId,
  amount: number,
): GameState {
  if (amount <= 0) return state;
  return resolveStackObjectEffects(
    state,
    [
      {
        effectType: "damage",
        amount,
        targetId: toId,
        isCombatDamage: false,
      },
    ],
    fromId,
    [{ type: "card", targetId: toId }],
  );
}

/**
 * Fight (CR 701.14) or Bite (#2548). Nothing happens unless both creatures
 * are still on the battlefield and still legal (CR 701.14b, 608.2b): a
 * targeted or "it" fighter must still be a creature you control, and the
 * other creature must still match its controller filter. Powers are read
 * before any damage is dealt, so both fighters deal damage at once.
 */
function fight(
  state: GameState,
  effect: Extract<CardEffect, { op: "Fight" | "Bite" }>,
  ctx: EffectContext,
): GameState {
  const fighterId =
    effect.fighter === "self"
      ? ctx.sourceId
      : (ctx.fighter?.targetId as CardInstanceId | undefined);
  const otherId = ctx.target?.targetId as CardInstanceId | undefined;
  if (!fighterId || !otherId) return state;
  const fighter = state.cards.get(fighterId);
  const other = state.cards.get(otherId);
  if (
    !fighter ||
    !other ||
    !isOnBattlefield(state, fighterId) ||
    !isOnBattlefield(state, otherId) ||
    !isCreature(fighter) ||
    !isCreature(other)
  )
    return state;
  if (effect.fighter !== "self" && fighter.controllerId !== ctx.controllerId)
    return state;
  if (!controllerStillMatches(state, otherId, effect.controller, ctx))
    return state;
  const fighterPower = getEffectivePower(fighter);
  const otherPower = getEffectivePower(other);
  let next = creatureDamage(state, fighterId, otherId, fighterPower);
  if (effect.op === "Fight")
    next = creatureDamage(next, otherId, fighterId, otherPower);
  return next;
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
      if (
        effect.target === "creature" &&
        !controllerStillMatches(state, target.targetId, effect.controller, ctx)
      )
        return state;
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
    case "CreatePredefinedToken": {
      const r = resolveTokenCreationEffect(
        state,
        sourceId,
        PREDEFINED_TOKENS[effect.token],
        effect.count,
        ctx.controllerId,
      );
      return r.success ? r.state : state;
    }
    case "Destroy": {
      // A target that no longer matches is illegal: nothing happens (CR 608.2b).
      if (
        !target ||
        !targetStillMatches(state, target.targetId, effect) ||
        !controllerStillMatches(state, target.targetId, effect.controller, ctx)
      )
        return state;
      const r = destroyCard(state, target.targetId as CardInstanceId);
      return r.success ? r.state : state;
    }
    case "Exile": {
      if (
        !target ||
        !targetStillMatches(state, target.targetId, effect) ||
        !controllerStillMatches(state, target.targetId, effect.controller, ctx)
      )
        return state;
      const r = exileCard(state, target.targetId as CardInstanceId);
      return r.success ? r.state : state;
    }
    case "Tap":
    case "Untap": {
      // #2538: an illegal target does nothing; tapping a tapped permanent
      // (or untapping an untapped one) changes nothing.
      if (
        !target ||
        !targetStillMatches(state, target.targetId, effect) ||
        !controllerStillMatches(state, target.targetId, effect.controller, ctx)
      )
        return state;
      const id = target.targetId as CardInstanceId;
      const r =
        effect.op === "Tap"
          ? tapCardAction(state, id)
          : untapCardAction(state, id);
      return r.success ? r.state : state;
    }
    case "ReturnToHand": {
      // #2546: an illegal target does nothing (CR 608.2b). The card goes to
      // its owner's hand (CR 400.3); a token ceases to exist (CR 111.8).
      if (
        !target ||
        !targetStillMatches(state, target.targetId, effect) ||
        !controllerStillMatches(state, target.targetId, effect.controller, ctx)
      )
        return state;
      const r = moveCardToZone(
        state,
        target.targetId as CardInstanceId,
        "hand",
      );
      return r.success ? r.state : state;
    }
    case "Counter": {
      if (!target) return state;
      const r = resolveCounterEffect(state, sourceId, target.targetId);
      return r.success ? r.state : state;
    }
    case "Pump": {
      const cardId = creatureFor(state, effect.target, ctx, effect.controller);
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
      const cardId = creatureFor(state, effect.target, ctx, effect.controller);
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
    case "Scry": {
      const r = resolveEffect(
        state,
        {
          effectType: "scry",
          amount: effect.amount,
          targetId: ctx.controllerId,
        },
        sourceId,
      );
      return r.success ? r.state : state;
    }
    case "Mill": {
      if (effect.who === "each_opponent") {
        let next = state;
        for (const opp of opponentsOf(state, ctx.controllerId)) {
          next = millPlayer(next, opp, effect.amount);
        }
        return next;
      }
      const player = playerFor(effect.who, ctx);
      return player ? millPlayer(state, player, effect.amount) : state;
    }
    case "Discard": {
      if (effect.who === "each_opponent") {
        let next = state;
        for (const opp of opponentsOf(state, ctx.controllerId)) {
          next = startDiscard(next, opp, effect.amount);
        }
        return next;
      }
      const player = playerFor(effect.who, ctx);
      return player ? startDiscard(state, player, effect.amount) : state;
    }
    case "CopySpell":
      return copyTriggeringSpell(state, effect.gain ?? [], ctx);
    case "Fight":
    case "Bite":
      return fight(state, effect, ctx);
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
/** True when the targeted card is still there and still matches `filter`. */
function targetStillMatches(
  state: GameState,
  targetId: string,
  filter: RemovalFilter,
): boolean {
  const card = state.cards.get(targetId as CardInstanceId);
  return Boolean(card) && matchesRemovalFilter(card!, filter);
}

export function resolveScriptedEffects(
  state: GameState,
  effects: readonly CardEffect[],
  stackObject: ScriptStackObject,
  kickerBonus: number = 0,
): GameState {
  const targets = stackObject.targets ?? [];
  let current = state;
  let next = 0;
  // The previous targeted effect's target, while it is still legal: what
  // "it" means in "... target creature you control. It fights ..." (#2548).
  let previous: Target | undefined;
  for (const effect of effects) {
    let target: Target | undefined;
    let fighter: Target | undefined;
    const count = effectTargetCount(effect);
    if (
      (effect.op === "Fight" || effect.op === "Bite") &&
      effect.fighter === "it"
    )
      fighter = previous;
    if (count > 0) {
      const taken = targets.slice(next, next + count);
      next += count;
      const legal =
        taken.length === count &&
        taken.every((t) => targetStillLegal(current, t));
      previous = legal ? taken[0] : undefined;
      if (!legal) continue;
      target = taken[count - 1];
      if (count === 2) fighter = taken[0];
    }
    current = applyEffect(current, effect, {
      controllerId: stackObject.controllerId as PlayerId,
      sourceId: (stackObject.sourceCardId as CardInstanceId) || undefined,
      target,
      fighter,
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
