import type {
  GameState,
  CardInstance,
  CardInstanceId,
  StackObject,
} from "../types";
import type { TriggerCondition } from "../oracle-text-parser/abilities";
import { isOnBattlefield } from "../types";
import { getTriggeredAbilities } from "./parse";
import { generateTriggeredAbilityId } from "./ids";
import { evaluateInterveningIfClause } from "./evaluate";
import { evaluateTriggerWhileCondition } from "../keyword-actions/ferocious";
import type {
  TriggerEvent,
  TriggerContext,
  TriggeredAbilityInstance,
} from "./types";

/**
 * CR 603.6a: does this ETB trigger care about the permanent that entered?
 * Without an `enteringCardId` in the context (older callers) every ETB
 * trigger fires, as before.
 */
function entersTriggerMatches(
  state: GameState,
  cardId: CardInstanceId,
  card: CardInstance,
  trigger: TriggerCondition,
  context?: TriggerContext,
): boolean {
  return subjectMatches(state, cardId, card, trigger, context?.enteringCardId);
}

/**
 * Does the permanent an enters/dies/attack trigger watches match its subject
 * ("this creature", "another creature you control", "a creature")? Without a
 * subject id (older callers) every such trigger fires, as before.
 */
export function subjectMatches(
  state: GameState,
  cardId: CardInstanceId,
  card: CardInstance,
  trigger: TriggerCondition,
  enteringId: CardInstanceId | undefined,
): boolean {
  if (!enteringId || !trigger.subject) return true;
  if (trigger.subject === "self") return enteringId === cardId;
  if (trigger.subject === "another" && enteringId === cardId) return false;
  // #2594 #16: "the equipped creature" / "the enchanted permanent"
  // — Equipment and Aura triggers that read the card's own
  // `attachedToId` (Goldvein Pick: "whenever equipped creature
  // attacks"). The source card is the equipment/enchantment; the
  // event is on the equipped/enchanted permanent.
  if (trigger.subject === "attached") return enteringId === card.attachedToId;
  const entering = state.cards.get(enteringId);
  if (!entering) return false;
  const filter = trigger.enteringFilter;
  if (!filter) return true;
  const typeLine = (entering.cardData.type_line ?? "").toLowerCase();
  if (
    filter.types.length > 0 &&
    !filter.types.some((type) => typeLine.includes(type))
  ) {
    return false;
  }
  if (
    filter.controller === "you" &&
    entering.controllerId !== card.controllerId
  )
    return false;
  if (
    filter.controller === "opponent" &&
    entering.controllerId === card.controllerId
  )
    return false;
  if (filter.nontoken && entering.isToken) return false;
  if (filter.subtype && !hasSubtype(typeLine, filter.subtype)) return false;
  return true;
}

/** CR 205.3: is `subtype` among the type line's subtypes (after the dash)? */
function hasSubtype(typeLine: string, subtype: string): boolean {
  const dash = typeLine.search(/[\u2014-]/);
  if (dash < 0) return false;
  return typeLine
    .slice(dash + 1)
    .split(/\s+/)
    .includes(subtype.toLowerCase());
}

/**
 * Wave 4.8 follow-up 19 lane 116 (#2614 follow-up):
 * the X value the engine has stored for the spell
 * identified by `spellCardId`. Returns `undefined` when
 * the spell isn't in `state.castVariableValues` (the
 * spell is not an X-cost spell, or the engine's
 * cast-time writer — a follow-up sub-piece, lane 116
 * piece 2/2 — hasn't yet stamped the map). The
 * `castTriggerMatches` consumer uses this to gate
 * triggers whose `castFilter.X: "X_spent_on_spell"` is
 * set, and downstream effects read the same value to
 * resolve an "X equals the X spent on the previous
 * spell" amount.
 */
export function evaluateCastVariable(
  state: GameState,
  spellCardId: CardInstanceId,
): number | undefined {
  return state.castVariableValues?.get(spellCardId);
}

/**
 * CR 601.2i / 603.2: does a cast trigger care about this spell and caster?
 * Without a caster in the context (older callers) every cast trigger fires,
 * as before; in real games only triggers whose filter was parsed fire.
 */
function castTriggerMatches(
  state: GameState,
  card: CardInstance,
  trigger: TriggerCondition,
  context?: TriggerContext,
): boolean {
  const filter = trigger.castFilter;
  if (!context?.castingPlayerId) return true;
  if (!filter || filter.self || filter.unsupported) return false;
  const caster = context.castingPlayerId;
  if (filter.caster === "you" && caster !== card.controllerId) return false;
  if (filter.caster === "opponent" && caster === card.controllerId)
    return false;
  const spell = context.spellCardId
    ? state.cards.get(context.spellCardId)
    : undefined;
  if (!spell) return false;
  const typeLine = (spell.cardData.type_line ?? "").toLowerCase();
  if (filter.types && !filter.types.some((t) => typeLine.includes(t)))
    return false;
  if (filter.excludeTypes?.some((t) => typeLine.includes(t))) return false;
  if (filter.multicolored && (spell.cardData.colors ?? []).length < 2)
    return false;
  if (filter.color && !(spell.cardData.colors ?? []).includes(filter.color))
    return false;
  if (filter.singleTarget) {
    const onStack = castSpellStackObject(state, spell.id);
    if (!onStack || onStack.targets.length !== 1) return false;
  }
  // Wave 4.8 follow-up 19 lane 116 (#2614 follow-up):
  // the `X: "X_spent_on_spell"` cast-filter arm gates
  // the trigger on the cast spell having X in its mana
  // cost AND `state.castVariableValues[spellCardId]`
  // being set. The trigger does NOT fire if either
  // condition is unmet (the schema-side enum is the
  // single value `"X_spent_on_spell"`; future arms
  // ride follow-up lanes).
  if (filter.X === "X_spent_on_spell") {
    if (!spell.cardData.mana_cost?.includes("X")) return false;
    if (evaluateCastVariable(state, spell.id) === undefined) return false;
  }
  return true;
}

/** The cast (not copied) spell on the stack for this card, topmost first. */
export function castSpellStackObject(
  state: GameState,
  spellCardId: CardInstanceId,
): StackObject | undefined {
  for (let i = state.stack.length - 1; i >= 0; i--) {
    const o = state.stack[i];
    if (o.type === "spell" && !o.isCopy && o.sourceCardId === spellCardId)
      return o;
  }
  return undefined;
}

/** CR 508.1m: does an attack trigger care about this attacker? */
function attackTriggerMatches(
  state: GameState,
  cardId: CardInstanceId,
  card: CardInstance,
  trigger: TriggerCondition,
  context?: TriggerContext,
): boolean {
  const attackerId = context?.attackerId;
  if (!attackerId) return true;
  // "this creature attacks" with no subject parsed is about itself.
  if (!trigger.subject && attackerId !== cardId) return false;
  if (!subjectMatches(state, cardId, card, trigger, attackerId)) return false;
  const filter = trigger.attackFilter;
  if (filter?.alone && context?.attackerCount !== 1) return false;
  if (filter?.defenderIsYou && context?.attackDefenderId !== card.controllerId)
    return false;
  return true;
}

export function detectTriggeredAbilities(
  state: GameState,
  event: TriggerEvent,
  context?: TriggerContext,
): TriggeredAbilityInstance[] {
  const triggeredAbilities: TriggeredAbilityInstance[] = [];

  // Wave 4.8 follow-up 3 lane 65 (#2614 follow-up): a
  // human-readable summary of the granted trigger's
  // effects, used as the `effect` text on the resulting
  // `TriggeredAbilityInstance`. The resolver reads the
  // raw effects via the `grantedEffects` bag field; the
  // text here is for logs / UI display. v1 covers
  // `Draw` and `GainLife`; other ops render as "an
  // effect" until a follow-up lane wires them.
  function summarizeGrantedEffects(
    effects: ReadonlyArray<{ op: string; [k: string]: unknown }>,
  ): string {
    if (effects.length === 0) return "an effect triggers";
    const parts = effects.map((e) => {
      if (e.op === "Draw") {
        const amount = typeof e.amount === "number" ? e.amount : 1;
        return `draw ${amount} card${amount === 1 ? "" : "s"}`;
      }
      if (e.op === "GainLife") {
        const amount = typeof e.amount === "number" ? e.amount : 1;
        return `gain ${amount} life`;
      }
      return "an effect triggers";
    });
    return parts.join(" and ");
  }

  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;

    const abilities = getTriggeredAbilities(card.cardData);

    for (const ability of abilities) {
      let shouldTrigger = false;

      switch (event) {
        case "entersBattlefield":
          shouldTrigger =
            ability.trigger.event === "entersBattlefield" &&
            entersTriggerMatches(state, cardId, card, ability.trigger, context);
          break;
        case "landfall":
          shouldTrigger =
            ability.trigger.event === "landfall" &&
            context?.landControllerId === card.controllerId;
          break;
        case "leavesBattlefield":
          shouldTrigger =
            ability.trigger.event === "leavesBattlefield" ||
            ability.trigger.event === "dies";
          break;
        case "damageDealt":
          shouldTrigger = ability.trigger.event === "damageDealt";
          break;
        case "dealsCombatDamageToPlayer":
          // "Whenever this creature deals combat damage to a player" (#2428).
          shouldTrigger =
            ability.trigger.event === "dealsCombatDamageToPlayer" &&
            context?.sourceCardId === cardId;
          break;
        case "dies":
        case "creatureDies":
          // CR 603.10a: a self dies trigger with no subject parsed ("when ~
          // is put into a graveyard from the battlefield") is about itself.
          shouldTrigger =
            ability.trigger.event === "dies" &&
            (context?.dyingCardId && !ability.trigger.subject
              ? context.dyingCardId === cardId
              : subjectMatches(
                  state,
                  cardId,
                  card,
                  ability.trigger,
                  context?.dyingCardId,
                ));
          break;
        case "attacked":
          shouldTrigger =
            ability.trigger.event === "attacked" &&
            attackTriggerMatches(state, cardId, card, ability.trigger, context);
          break;
        case "upkeep": {
          const whose = context?.upkeepPlayerId;
          const of = ability.trigger.upkeepOf ?? "you";
          shouldTrigger =
            ability.trigger.event === "upkeep" &&
            (!whose ||
              of === "each" ||
              (of === "you" && whose === card.controllerId) ||
              (of === "opponent" && whose !== card.controllerId));
          break;
        }
        case "phaseChange":
        case "beginningOfTurn":
          shouldTrigger =
            ability.trigger.event === "upkeep" ||
            ability.trigger.event === "phaseEnds" ||
            ability.trigger.event === "turnEnds" ||
            ability.trigger.event === "turnBegins" ||
            ability.trigger.event === "beginningOfTurn";
          break;
        case "endOfTurn":
          shouldTrigger =
            ability.trigger.event === "turnEnds" ||
            ability.trigger.event === "phaseEnds" ||
            ability.trigger.event === "endOfTurn" ||
            ability.trigger.event === "cleanupStep";
          break;
        case "drawCard": {
          // CR 121.2 / 603.2 (#2614 follow-up lane 87): a `drawCard`
          // trigger fires for any player drawing a card. The
          // optional `whoseDraws` filter narrows to opponent-only
          // draws (Scrawling Crawler's second half) or your own
          // draws (mirror card); "any" is the default. The
          // `drawingPlayerId` is set by `drawCards` on every draw;
          // legacy callers without it fire the trigger for any draw.
          const drawer = context?.drawingPlayerId;
          const whose = ability.trigger.whoseDraws ?? "any";
          shouldTrigger =
            ability.trigger.event === "drawCard" &&
            (drawer === undefined ||
              whose === "any" ||
              (whose === "you" && drawer === card.controllerId) ||
              (whose === "opponent" && drawer !== card.controllerId));
          break;
        }
        case "cast":
        case "spellCast":
          shouldTrigger =
            (ability.trigger.event === "cast" ||
              ability.trigger.event === "spellCast" ||
              (!context?.castingPlayerId &&
                ability.trigger.event === "abilityActivated")) &&
            (ability.trigger.event === "abilityActivated" ||
              castTriggerMatches(state, card, ability.trigger, context));
          break;
        case "chapter":
          // CR 714.2b: a chapter ability triggers when lore counters bring
          // the count from below its chapter number to at least it.
          shouldTrigger =
            ability.trigger.event === "chapter" &&
            context?.sourceCardId === cardId &&
            ability.trigger.chapter !== undefined &&
            ability.trigger.chapter > (context.loreFrom ?? 0) &&
            ability.trigger.chapter <= (context.loreTo ?? 0);
          break;
        case "lifeGain":
          shouldTrigger = ability.trigger.event === "lifeGain";
          break;
        case "targeted": {
          // "Whenever a creature you control or a creature spell you
          // control becomes the target of a spell or ability an opponent
          // controls" (#2614 Surrak).
          const targeted = context?.targetedCardId
            ? state.cards.get(context.targetedCardId)
            : undefined;
          shouldTrigger =
            ability.trigger.event === "targeted" &&
            !!targeted &&
            targeted.controllerId === card.controllerId &&
            !!context?.targetingPlayerId &&
            context.targetingPlayerId !== card.controllerId;
          break;
        }
        case "crime":
          // "Whenever you commit a crime" (CR 700.13, #2614 Magda).
          shouldTrigger =
            ability.trigger.event === "crime" &&
            context?.targetingPlayerId === card.controllerId;
          break;
        case "lifeLost":
          shouldTrigger = ability.trigger.event === "lifeLost";
          break;
      }

      // CR 603.2: a "while" clause is part of the trigger event; an
      // unrecognised one leaves the trigger ungated, as before.
      if (shouldTrigger && ability.whileCondition) {
        shouldTrigger =
          evaluateTriggerWhileCondition(
            ability.whileCondition,
            state,
            card.controllerId,
          ) ?? true;
      }

      // Wave 4.8 follow-up lane 58 (#2614 follow-up): the
      // triggered-ability gate parallel to `canActivateAbility`'s
      // lane 54 activated-ability gate. When the source card carries
      // `losesAbilities: true` (stamped by `refreshAuraBonuses` for
      // any Aura with `static.removesAllAbilities: true` — Witness
      // Protection-style "Enchanted creature loses all other
      // abilities"), skip firing its scripted triggers entirely.
      // Mirrors the CR 603.2 / 602.2d rule that "loses all other
      // abilities" removes both activated and triggered abilities
      // from the enchanted permanent. Mana-ability carve-out is
      // not applicable to triggered abilities (mana abilities are
      // activated; CR 605).
      //
      // The check runs AFTER the whileCondition gate so a
      // `losesAbilities` permanent that ALSO has an active
      // while-condition trigger doesn't burn cycles on the
      // condition evaluator; the gate runs as a one-time filter.
      // The check is a no-op when `card.losesAbilities` is
      // undefined (the v1 default; lane 54's
      // `refreshAuraBonuses` stamps the flag on the enchanted
      // target only).
      if (shouldTrigger && card.losesAbilities === true) {
        shouldTrigger = false;
      }

      // Wave 4.8 follow-up 2 lane 62 (#2614 follow-up): counter
      // gate parallel to the `losesAbilities` gate above. When
      // the script's trigger carries `counter_gate: { counter,
      // op, n }`, the engine only fires the trigger if the source
      // permanent's `card.instanceCounters[counter]` matches the
      // gate's comparator (CR 603.2 "while" gate variant — NOT
      // an intervening-if CR 603.4). Default count is `0` when
      // `card.instanceCounters` is undefined (matches the lane
      // 59 v1 default; field is `Record<string, number>`).
      //
      // The check runs AFTER both the `whileCondition` and
      // `losesAbilities` gates; the gate is a one-time filter and
      // doesn't burn cycles on the regex evaluator when the
      // higher-priority gates have already disqualified the
      // trigger. The check is a no-op when `ability.counterGate`
      // is undefined (v1 default for all triggers without the
      // field).
      //
      // The sample cards are Redcap Gutter-Dweller's deferred
      // "Goblins you control have menace when this has 3+
      // +1/+1 counters" half (lane 57 JSON shape, lane 62 wires
      // the engine gate it implicitly carried).
      if (shouldTrigger && ability.counterGate) {
        const gate = ability.counterGate;
        const count = card.instanceCounters?.[gate.counter] ?? 0;
        const passes =
          gate.op === "gte" ? count >= gate.n : count === gate.n;
        if (!passes) shouldTrigger = false;
      }

      if (shouldTrigger && ability.interveningIf) {
        shouldTrigger = evaluateInterveningIfClause(
          ability.interveningIf,
          state,
          card.controllerId,
          card,
          context,
        );
      }

      if (shouldTrigger) {
        const sourceCardTimestamp = card.enteredBattlefieldTimestamp;
        triggeredAbilities.push({
          id: generateTriggeredAbilityId(),
          sourceCardId: cardId,
          triggeringPlayerId: card.controllerId,
          triggerCondition: ability.trigger.event,
          effect: ability.effect,
          timestamp: Date.now(),
          sourceCardTimestamp,
          context,
          interveningIf: ability.interveningIf,
        });
      }
    }
  }

  // Wave 4.8 follow-up 3 lane 65 (#2614 follow-up):
  // granted triggers from attached Auras. After the
  // main scripted-trigger loop, iterate the
  // `card.grantedTriggers` list (stamped by
  // `refreshAuraBonuses` for any Aura with
  // `static.grants.triggers`) and fire each granted
  // trigger alongside the card's own scripted triggers.
  // The granted trigger's subject is the ENCHANTED CARD
  // (the dying card), not the Aura; the effect's
  // `who: "you"` resolves to the dying card's controller
  // (the same as a normal self-dies trigger on the
  // enchanted card would). The granted trigger's
  // `sourceControllerId` is the Aura's controller at the
  // time the trigger was stamped — used for
  // `who: "controller"` style effects that point at the
  // Aura's controller, not the enchanted card's
  // controller. v1 supports a single `event: "dies"`
  // arm; multi-event and "grants to another card"
  // variants are follow-up lanes.
  //
  // The check runs AFTER the main scripted-trigger loop
  // so the standard gate (CR 603.2 / 603.4) ordering is
  // preserved — the main loop's whileCondition /
  // losesAbilities / counterGate gates apply to the
  // card's own scripted triggers, and the granted
  // trigger fires only if the same event matches. The
  // granted trigger's `effect` is a `text` string built
  // from the granted `event` + `effects` so the
  // downstream resolver can route it (the resolver
  // already handles `text`-shaped effects on
  // StackObjects).
  for (const [cardId, card] of state.cards) {
    if (!isOnBattlefield(state, cardId)) continue;
    const granted = card.grantedTriggers;
    if (!granted || granted.length === 0) continue;
    for (const t of granted) {
      // v1: only the "dies" event matches. Other events
      // are reserved for follow-up lanes.
      if (t.event !== "dies") continue;
      if (
        event !== "dies" &&
        event !== "creatureDies"
      ) {
        continue;
      }
      // CR 603.10a: a self-dies trigger on the dying card
      // itself. The granted trigger's subject is the
      // dying card (the enchanted card, NOT the Aura);
      // we reuse the existing subjectMatches path by
      // routing through the cardId check below.
      const isSelfMatch =
        context?.dyingCardId === cardId ||
        // For the v1 self-dies shape, the dyingCardId
        // matches the card's id; the granted trigger
        // fires when the enchanted card is the one
        // dying.
        (context?.dyingCardId !== undefined && context.dyingCardId === cardId);
      if (!isSelfMatch) continue;
      triggeredAbilities.push({
        id: generateTriggeredAbilityId(),
        sourceCardId: cardId,
        triggeringPlayerId: card.controllerId,
        triggerCondition: "dies",
        effect: `When ${card.cardData.name} dies, ${summarizeGrantedEffects(t.effects)}.`,
        timestamp: Date.now(),
        sourceCardTimestamp: card.enteredBattlefieldTimestamp,
        context,
        interveningIf: undefined,
        // Wave 4.8 follow-up 3 lane 65: stash the
        // granted effects + source controller on the
        // instance so the resolver can route them. The
        // existing trigger resolver doesn't know about
        // grantedTriggers today; v1 routes via these
        // bag fields.
        grantedEffects: t.effects,
        grantedSourceControllerId: t.sourceControllerId,
      });
    }
  }

  triggeredAbilities.sort((a, b) => {
    const activePlayerId = state.turn.activePlayerId;
    const playerIds = Array.from(state.players.keys());

    const aIsActive = a.triggeringPlayerId === activePlayerId;
    const bIsActive = b.triggeringPlayerId === activePlayerId;

    if (aIsActive && !bIsActive) return -1;
    if (!aIsActive && bIsActive) return 1;

    if (aIsActive && bIsActive) {
      if (a.sourceCardTimestamp !== b.sourceCardTimestamp) {
        return a.sourceCardTimestamp - b.sourceCardTimestamp;
      }
      return 0;
    }

    const activeIndex = playerIds.indexOf(activePlayerId);
    const aPosition =
      (playerIds.indexOf(a.triggeringPlayerId) -
        activeIndex +
        playerIds.length) %
      playerIds.length;
    const bPosition =
      (playerIds.indexOf(b.triggeringPlayerId) -
        activeIndex +
        playerIds.length) %
      playerIds.length;

    if (aPosition !== bPosition) {
      return aPosition - bPosition;
    }

    if (a.sourceCardTimestamp !== b.sourceCardTimestamp) {
      return a.sourceCardTimestamp - b.sourceCardTimestamp;
    }

    return 0;
  });

  return triggeredAbilities;
}
