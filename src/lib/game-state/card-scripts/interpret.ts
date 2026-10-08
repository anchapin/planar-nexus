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
  Zone,
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
import {
  addCardToZone,
  millCards,
  moveCardBetweenZones,
  shuffleLibraryZone,
  shuffleZone,
} from "../zones";
import { startDiscard } from "../keyword-actions/discard-choice";
import { addCounters, isCreature } from "../card-instance";
import { getEffectivePower } from "../evergreen-keywords";
import { addUntilEndOfTurnKeywords } from "../pt-until-end-of-turn";
import { copySpellOnStack } from "../spell-casting/resolve";
import { attachEquipment } from "../keyword-actions/equip";
import {
  addUntilEndOfTurnKeyword,
  CANT_BE_BLOCKED,
} from "../pt-until-end-of-turn";
import { getCardScript } from "./registry";
import { addMana } from "../mana/mana-pool";
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
  SearchLibraryFilter,
} from "./schema";
import { EQUIPMENT_ATTACH_ON_ENTER_TEXT } from "./schema";

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
  /**
   * Whether the spell/ability was kicked (CR 702.32, #2564). Read from the
   * stack object — true iff `wasKicked` is set or `timesKicked > 0`. The
   * interpreter skips effects whose `if_kicked` doesn't match this flag.
   * For a permanent ETB trigger fired by a kicked cast, the same value
   * flows through the trigger's `StackObject` to the interpreter here.
   */
  wasKicked: boolean;
  /** The spell's X (#2552); 0 when it has none. */
  x: number;
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

/**
 * Per-effect target legality: most effects want their target on the
 * battlefield (the default `targetStillLegal`). ReturnFromZone targets a
 * card in a graveyard (#2560), so its target is legal as long as the card
 * exists in the right graveyard.
 */
function effectTargetLegal(
  state: GameState,
  target: Target,
  effect: CardEffect,
  ctx: EffectContext,
): boolean {
  if (effect.op === "ReturnFromZone") {
    if (target.type !== "card") return false;
    return returnFromZoneStillMatches(state, target.targetId, effect, ctx);
  }
  return targetStillLegal(state, target);
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

/**
 * The controller of `ctx.target` (a card), read from the card itself so a
 * permanent destroyed by an earlier effect still answers with its last
 * known controller (CR 608.2h). Demolition Field (#2614).
 */
function targetControllerOf(
  state: GameState,
  ctx: EffectContext,
): PlayerId | undefined {
  if (ctx.target?.type !== "card") return undefined;
  return state.cards.get(ctx.target.targetId as CardInstanceId)?.controllerId;
}

function opponentsOf(state: GameState, playerId: PlayerId): PlayerId[] {
  return [...state.players.keys()].filter((p) => p !== playerId);
}

/**
 * The first creature `playerId` controls on the battlefield. Used as the
 * auto-pick target for `AttachEquipment` when the ability fires with no
 * chosen target (e.g. the synthetic ETB attach for an Equipment, #2561).
 * The order follows the battlefield zone, which the engine treats as
 * timestamp-ordered.
 */
function firstControlledCreature(
  state: GameState,
  playerId: PlayerId,
): CardInstanceId | undefined {
  const zone = state.zones.get(`${playerId}-battlefield`);
  if (!zone) return undefined;
  for (const id of zone.cardIds) {
    const card = state.cards.get(id);
    if (card && isCreature(card)) return id;
  }
  return undefined;
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

/**
 * True when `cardData` matches every set key of `filter`. A "basic land" is a
 * land whose `type_line` includes "Basic" (CR 305.9). The other type checks
 * delegate to the engine's `is…` helpers, which read `type_line` and respect
 * the crewed-Vehicle / turn-form cases.
 *
 * When the filter has an `or` arm (#2594 follow-up), the card matches if any
 * sub-filter matches. Top-level AND keys and `or` arms compose: a card must
 * pass both (all AND keys) AND (any OR sub-filter). The `or` arm is
 * recursive — a sub-filter can carry its own `or`.
 */
function searchMatches(
  cardData: { type_line: string; cmc: number; name: string; colors: string[] },
  filter: SearchLibraryFilter,
): boolean {
  if (filter.basic_land && !/basic/i.test(cardData.type_line)) return false;
  if (filter.land && !/land/i.test(cardData.type_line)) return false;
  if (filter.creature && !/creature/i.test(cardData.type_line)) return false;
  if (filter.artifact && !/artifact/i.test(cardData.type_line)) return false;
  if (filter.enchantment && !/enchantment/i.test(cardData.type_line))
    return false;
  if (filter.instant_or_sorcery) {
    const t = cardData.type_line.toLowerCase();
    if (!t.includes("instant") && !t.includes("sorcery")) return false;
  }
  if (filter.mv_le !== undefined && cardData.cmc > filter.mv_le) return false;
  if (filter.mv_eq !== undefined && cardData.cmc !== filter.mv_eq) return false;
  if (
    filter.name &&
    cardData.name.toLowerCase() !== filter.name.toLowerCase()
  ) {
    return false;
  }
  if (filter.color) {
    const want = filter.color;
    const map: Record<string, string> = {
      W: "W",
      U: "U",
      B: "B",
      R: "R",
      G: "G",
    };
    const wantLower = map[want].toLowerCase();
    const has = (cardData.colors ?? [])
      .map((c) => c.toLowerCase())
      .includes(wantLower);
    if (!has) return false;
  }
  if (filter.or) {
    if (
      !filter.or.some((sub: SearchLibraryFilter) =>
        searchMatches(cardData, sub),
      )
    )
      return false;
  }
  return true;
}

/**
 * Resolve a "search your library" effect (CR 603.9d, CR 608.2d, #2562). The
 * searcher is the controller or the previous targeted player. The library is
 * always shuffled afterwards, even if nothing was found.
 *
 * "Up to N" (`count`, 1 or 2) takes the first N matches in library order;
 * letting the player choose which cards needs UI plumbing and is a follow-up
 * lane. Finding fewer than N is fine (CR 701.19b: a search for cards with a
 * stated quality need not find them all).
 *
 * "Reveal" is not modelled (the card simply moves into its new zone).
 * `tapped` puts battlefield cards onto the battlefield tapped (CR 110.5b).
 */
function searchLibrary(
  state: GameState,
  effect: Extract<CardEffect, { op: "SearchLibrary" }>,
  ctx: EffectContext,
): GameState {
  // Card scripts are stored without zod parsing (#1814) so the schema's
  // `.default(...)` rules do not run; fill them in here. This is the same
  // gap that the schema covers on the app/AI side.
  const who = effect.who ?? "you";
  const destination = effect.destination ?? "hand";
  const shuffle = effect.shuffle ?? true;
  const searcher =
    who === "target_controller"
      ? targetControllerOf(state, ctx)
      : playerFor(who, ctx);
  if (!searcher) return state;
  const libraryKey = `${searcher}-library`;
  const library = state.zones.get(libraryKey);
  if (!library) return state;

  // Take the first `count` matching cards, in library order.
  const count = effect.count ?? 1;
  const chosen: CardInstanceId[] = [];
  for (const id of library.cardIds) {
    if (chosen.length >= count) break;
    const inst = state.cards.get(id);
    if (inst && searchMatches(inst.cardData, effect.filter)) chosen.push(id);
  }

  // CR 603.9d / 608.2d: shuffle the library even if nothing was found.
  let nextLibrary: Zone = shuffle ? shuffleZone(library) : library;
  const zones = new Map(state.zones);
  const cards = new Map(state.cards);
  // "onto the battlefield tapped": the permanent enters tapped (CR 110.5b).
  const entersTapped = destination === "battlefield" && effect.tapped === true;

  for (const id of chosen) {
    // Move the card out of the library first, then into the destination, so
    // one move covers both steps regardless of destination semantics.
    nextLibrary = {
      ...nextLibrary,
      cardIds: nextLibrary.cardIds.filter((c) => c !== id),
    };

    // CR 400.3: cards put into a hand go to their owner's hand. The library
    // card's owner is the searcher, so the destination zone key is defined.
    const owner = cards.get(id)?.ownerId ?? searcher;
    let destKey: string;
    let position: "top" | "bottom" | undefined;
    switch (destination) {
      case "hand":
        destKey = `${owner}-hand`;
        break;
      case "battlefield":
        destKey = `${searcher}-battlefield`;
        break;
      case "library_top":
        destKey = `${owner}-library`;
        position = "top";
        break;
      case "library_bottom":
        destKey = `${owner}-library`;
        position = "bottom";
        break;
    }

    if (destKey === libraryKey) {
      // Back into the same, already shuffled library (top or bottom). The
      // top of a zone is the last id (getTopCard in zones.ts).
      nextLibrary = addCardToZone(nextLibrary, id, position);
      const inst = cards.get(id);
      if (inst) cards.set(id, { ...inst, currentZoneKey: destKey });
      continue;
    }

    const destZone = zones.get(destKey);
    // No destination zone: the card has still left the library (so it does
    // not appear twice); refuse the move.
    if (!destZone) continue;

    const moved = moveCardBetweenZones(nextLibrary, destZone, id, position);
    nextLibrary = moved.from;
    zones.set(destKey, moved.to);
    const inst = cards.get(id);
    if (inst) {
      cards.set(id, {
        ...inst,
        currentZoneKey: destKey,
        ...(entersTapped ? { isTapped: true } : {}),
      });
    }
  }

  zones.set(libraryKey, nextLibrary);

  // Fabled Passage: "Then if you control four or more lands, untap that
  // land." Counted after the found land is on the battlefield.
  if (entersTapped && effect.untap_if_lands !== undefined) {
    const battlefieldIds = zones.get(`${searcher}-battlefield`)?.cardIds ?? [];
    const lands = battlefieldIds.filter((id) =>
      /land/i.test(cards.get(id)?.cardData.type_line ?? ""),
    ).length;
    if (lands >= effect.untap_if_lands) {
      for (const id of chosen) {
        const inst = cards.get(id);
        if (inst && inst.currentZoneKey === `${searcher}-battlefield`) {
          cards.set(id, { ...inst, isTapped: false });
        }
      }
    }
  }

  return { ...state, zones, cards };
}

/** Script mana symbol to the engine's mana pool field (#2565). */
const MANA_POOL_KEY = {
  W: "white",
  U: "blue",
  B: "black",
  R: "red",
  G: "green",
  C: "colorless",
} as const;

function applyEffect(
  state: GameState,
  scripted: CardEffect,
  ctx: EffectContext,
): GameState {
  const effect = withX(scripted, ctx.x);
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
      // CR 702.33d: "If this spell was kicked, it deals N damage instead"
      // — for a kicked spell the replacement amount is the one declared on
      // the `if_kicked: true` effect. We dispatch the kicker-replacement
      // variant via `kickedAmount` so the engine's resolution layer applies
      // the "instead" rule rather than adding the default +1 per kick. The
      // un-kicked effect (no `if_kicked` or `if_kicked: false`) supplies
      // the base amount; the kicked effect supplies the replacement.
      const damageAmount =
        ctx.wasKicked && effect.kickedAmount !== undefined
          ? effect.kickedAmount
          : effect.amount;
      const stackEffect: {
        effectType: "damage";
        amount: number;
        targetId: CardInstanceId | PlayerId;
        isCombatDamage: boolean;
        kickedAmount?: number;
      } = {
        effectType: "damage",
        amount: damageAmount,
        targetId: target.targetId as CardInstanceId | PlayerId,
        isCombatDamage: false,
      };
      // CR 702.33d — carry `kickedAmount` on the resolved StackEffect so
      // `applyKickerBonus` recognizes the "instead" rule and replaces the
      // amount outright (instead of adding the +1 per-kick bonus on top
      // of the already-replaced amount).
      if (ctx.wasKicked && effect.kickedAmount !== undefined) {
        stackEffect.kickedAmount = effect.kickedAmount;
      }
      return resolveStackObjectEffects(
        state,
        [stackEffect],
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
    case "AddMana": {
      // A single fixed color resolves here: a triggered or spell "add
      // {R}" (#2565). Activated mana abilities never reach the stack
      // (CR 605.3a); with a color choice ("any", or "{R} or {G}") they
      // go through the mana ability path, which asks for the color.
      if (effect.colors === "any" || effect.colors.length !== 1) return state;
      return addMana(state, ctx.controllerId, {
        [MANA_POOL_KEY[effect.colors[0]]]: effect.amount,
      });
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
    case "ReturnFromZone": {
      // #2560: return a card from a non-battlefield zone to the battlefield.
      // The target is a card in the chosen graveyard; we move it with
      // `moveCardToZone`, which already fires ETB triggers (Renown, Tribute,
      // scripted) and applies "enters with" counters (CR 614.1c).
      if (!target) return state;
      if (!returnFromZoneStillMatches(state, target.targetId, effect, ctx))
        return state;
      const cardId = target.targetId as CardInstanceId;
      // CR 400.3: a card put onto the battlefield by a player different
      // from its owner is controlled by the player putting it there. The
      // engine's `moveCardToZone` uses `card.controllerId` to pick the
      // destination battlefield, so we transfer control to the effect's
      // controller when the card's current controller differs (the
      // "from an opponent's graveyard" path).
      const card = state.cards.get(cardId);
      if (!card) return state;
      const prepared =
        card.controllerId !== ctx.controllerId
          ? {
              ...state,
              cards: new Map(state.cards).set(cardId, {
                ...card,
                controllerId: ctx.controllerId,
              }),
            }
          : state;
      const r = moveCardToZone(prepared, cardId, "battlefield");
      return r.success ? r.state : state;
    }
    case "Counter": {
      if (!target) return state;
      const r = resolveCounterEffect(state, sourceId, target.targetId);
      return r.success ? r.state : state;
    }
    case "AttachEquipment": {
      // The source of the ability is the equipment; the target is a
      // creature (usually the spell's chosen target). When the ability
      // fires from a synthetic ETB with no chosen target, fall back to
      // the first creature the equipment's controller controls on the
      // battlefield (CR 301.5c, #2561): the "fizzle on no legal target"
      // path the engine already uses elsewhere.
      if (!sourceId) return state;
      // `effect.controller` is the schema's "you"/"opponent" filter; the
      // engine path is always "you" because an Equipment cannot attach to
      // a creature its controller doesn't control.
      if (effect.controller === "opponent") return state;
      // `creatureFor` applies the controller filter and the "is on the
      // battlefield" check for us. When the spell has no chosen target
      // (e.g. the synthetic ETB attach), `ctx.target` is undefined and
      // we fall back to the first creature the controller controls.
      let cardId = creatureFor(state, effect.target, ctx, effect.controller);
      if (!cardId) {
        const fallback = firstControlledCreature(state, ctx.controllerId);
        if (!fallback) return state;
        cardId = fallback;
      }
      // CR 301.5c: the equipment's controller must control the target.
      // `creatureFor` already enforces `controller === "you"`, but the
      // synthetic-ETB fallback picks "the first creature the controller
      // controls" directly, which the controller filter happens to also
      // satisfy. The engine's `attachEquipment` is a low-level move and
      // does not recheck, so we don't need to.
      const r = attachEquipment(state, sourceId, cardId);
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
      if (!r.success) return state;
      // CR 611.2a / 514.2 / 702.15: a scripted Pump with `keywords` grants
      // those keywords to the target until end of turn (e.g. Divine
      // Resilience's lifelink, #2564). The until-end-of-turn keyword
      // buffer is read by `evergreen-keywords.hasKeyword` (layer 6) and
      // cleared by the cleanup step in game-state/index.ts.
      if (effect.keywords && effect.keywords.length > 0) {
        return addUntilEndOfTurnKeywords(r.state, cardId, effect.keywords);
      }
      return r.state;
    }
    case "GrantKeyword": {
      // "it" shares the previous targeted effect's target (resolved as
      // ctx.target in resolveScriptedEffects), e.g. Adamant Will (#2567).
      const cardId = creatureFor(
        state,
        effect.target === "self" ? "self" : "creature",
        ctx,
        effect.controller,
      );
      if (!cardId) return state;
      return addUntilEndOfTurnKeyword(state, cardId, effect.keyword);
    }
    case "CantBeBlocked": {
      // #2614 (Escape Tunnel): "can't be blocked this turn". The power
      // bound is part of the target's legality, so it's rechecked here
      // (CR 608.2b); a creature that grew past it is an illegal target.
      const cardId = creatureFor(
        state,
        effect.target === "self" ? "self" : "creature",
        ctx,
        effect.controller,
      );
      if (!cardId) return state;
      if (effect.max_power !== undefined) {
        const card = state.cards.get(cardId);
        if (
          !card ||
          !matchesRemovalFilter(card, {
            target: "creature",
            max_power: effect.max_power,
          })
        )
          return state;
      }
      return addUntilEndOfTurnKeyword(state, cardId, CANT_BE_BLOCKED);
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
    case "SearchLibrary":
      return searchLibrary(state, effect, ctx);
    case "ShuffleLibrary": {
      const who = effect.who ?? "you";
      const player = playerFor(who, ctx);
      if (!player) return state;
      return shuffleLibraryZone(state, player);
    }
    case "Fight":
    case "Bite":
      return fight(state, effect, ctx);
  }
}

type ScriptStackObject = Pick<
  StackObject,
  "controllerId" | "sourceCardId" | "targets"
> &
  Partial<
    Pick<
      StackObject,
      | "triggeringStackObjectId"
      | "chosenModes"
      | "variableValues"
      | "wasKicked"
      | "timesKicked"
    >
  >;

type XValue = "X" | "-X";
/** An effect with its X amounts replaced by numbers. */
type ResolvedEffect = CardEffect extends infer E
  ? E extends unknown
    ? { [K in keyof E]: Exclude<E[K], XValue> }
    : never
  : never;

/** Replace "X" / "-X" with the spell's X (CR 107.3a, #2552). */
export function withX(effect: CardEffect, x: number): ResolvedEffect {
  const out: Record<string, unknown> = { ...effect };
  for (const [key, value] of Object.entries(out)) {
    if (value === "X") out[key] = x;
    else if (value === "-X") out[key] = -x;
  }
  return out as ResolvedEffect;
}

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

/**
 * True when `cardId` is still in the chosen graveyard and still matches
 * the ReturnFromZone filter (#2560). The card is in the graveyard under
 * the player named by the filter's `controller` (default "you" = the
 * ability's controller). The filter narrows by creature and mana value.
 *
 * A graveyard card's owner is the player whose graveyard it sits in (CR
 * 404.1, CR 400.3): even a stolen card returns to its owner's graveyard
 * on death. We use `ownerId` to find the right graveyard, not
 * `controllerId` (which on a card in a graveyard is normally the same as
 * the owner, but the engine doesn't guarantee that).
 */
function returnFromZoneStillMatches(
  state: GameState,
  cardId: string,
  effect: Extract<CardEffect, { op: "ReturnFromZone" }>,
  ctx: EffectContext,
): boolean {
  const card = state.cards.get(cardId as CardInstanceId);
  if (!card) return false;
  const filterController = effect.filter?.controller ?? "you";
  // The graveyard to inspect: the ability's controller for "you", the
  // first opponent (in two-player games, "opponent" is unambiguous) for
  // "opponent".
  const graveyardOwner =
    filterController === "you"
      ? ctx.controllerId
      : opponentsOf(state, ctx.controllerId)[0];
  if (!graveyardOwner) return false;
  // The card must actually be in that player's graveyard. The "controller"
  // side of the filter is about whose graveyard to search; the card's
  // owner is the graveyard's owner (CR 404.1).
  if (card.ownerId !== graveyardOwner) return false;
  const graveyardKey = `${graveyardOwner}-graveyard`;
  const graveyard = state.zones.get(graveyardKey);
  if (!graveyard?.cardIds.includes(cardId as CardInstanceId)) return false;
  if (effect.filter?.creature === true && !isCreature(card)) return false;
  if (effect.filter?.mv_le !== undefined) {
    const cmc = card.cardData.cmc ?? 0;
    if (cmc > effect.filter.mv_le) return false;
  }
  return true;
}

/**
 * CR 702.32 / CR 702.85, #2564, #2594 — match a per-effect `if_kicked` gate
 * against the actual charge count. Three shapes:
 *   - `if_kicked: true`  — runs iff timesKicked >= 1
 *   - `if_kicked: false` — runs iff timesKicked === 0
 *   - `if_kicked: N`     — runs iff timesKicked >= N (N >= 1)
 *
 * Kept as a small named function (vs inlining) so the schema-style values
 * `true` / `false` / `number` get a single source of truth for what "matches
 * the gate" means; the caller still passes `wasKicked` (the boolean mirror)
 * so a single-kicker stack with `wasKicked: true, timesKicked: 1` matches
 * either a `true` gate or a numeric gate of `1`.
 */
function kickerGateMatches(
  gate: boolean | number,
  timesKicked: number,
  wasKicked: boolean,
): boolean {
  if (typeof gate === "number") return timesKicked >= gate;
  // Boolean gate: `true` matches any kick (>= 1); `false` matches no kick.
  return gate === wasKicked;
}

export function resolveScriptedEffects(
  state: GameState,
  effects: readonly CardEffect[],
  stackObject: ScriptStackObject,
  kickerBonus: number = 0,
): GameState {
  const targets = stackObject.targets ?? [];
  const x = stackObject.variableValues?.get("X") ?? 0;
  // CR 702.32, #2564: a spell is "kicked" iff `wasKicked` is set or
  // `timesKicked > 0`. The interpreter uses this to gate `if_kicked`
  // effects. A multikicker spell that paid 2+ charges still resolves its
  // `if_kicked: true` branch (the engine's existing `applyKickerBonus`
  // already scales the base amount by the bonus; the kicker-replacement
  // effect on the script just turns the bonus on and off).
  // CR 702.85, #2594: a multikicker spell stamps `timesKicked` with the
  // actual charge count (0..N), not just 0/1. Tiered bonus effects use
  // `if_kicked: N` (a positive integer) to gate on `timesKicked >= N`,
  // so e.g. a "Multikicker {1}" spell can layer "if kicked 2+ times, also
  // draw a card" alongside the always-scaling damage effect.
  const timesKicked = stackObject.timesKicked ?? 0;
  const wasKicked = stackObject.wasKicked === true || timesKicked > 0;
  let current = state;
  let next = 0;
  // The previous targeted effect's target, while it is still legal: what
  // "it" means in "... target creature you control. It fights ..." (#2548).
  let previous: Target | undefined;
  for (const effect of effects) {
    // CR 702.32 — per-effect Kicker gate. An effect whose `if_kicked` is
    // set is applied only when the spell/ability was kicked the right
    // amount. The three shapes:
    //   - `if_kicked: true`  — runs iff timesKicked >= 1
    //   - `if_kicked: false` — runs iff timesKicked === 0
    //   - `if_kicked: N`     — runs iff timesKicked >= N (N >= 1)
    // When unset, the effect always applies. A common shape is a base
    // effect (`if_kicked: false`) paired with a kicker-replacement effect
    // (`if_kicked: true`); the gate below picks the one that matches the
    // actual cast state.
    if (
      effect.if_kicked !== undefined &&
      !kickerGateMatches(effect.if_kicked, timesKicked, wasKicked)
    ) {
      // A skipped effect still consumes its target slot from the stack
      // object's targets list, EVEN for the base of a kicker-replacement
      // pair — that way the kicked variant can inherit the base's target
      // (the "deals N instead" pattern) without taking a second slot of
      // its own. The replacement effect skips the cursor bump below and
      // reuses the base's chosen target via `previous`.
      const skippedCount = effectTargetCount(effect);
      if (skippedCount > 0) {
        const taken = targets.slice(next, next + skippedCount);
        const ctxForLegality: EffectContext = {
          controllerId: stackObject.controllerId as PlayerId,
          sourceId: (stackObject.sourceCardId as CardInstanceId) || undefined,
          kickerBonus,
          wasKicked,
          x,
          triggeringStackObjectId: stackObject.triggeringStackObjectId,
        };
        const legal =
          taken.length === skippedCount &&
          taken.every((t) =>
            effectTargetLegal(current, t, effect, ctxForLegality),
          );
        if (legal) {
          // Remember the chosen target so a following kicker-replacement
          // can inherit it via `previous`. CR 608.2b (the engine still
          // re-checks target legality on resolution).
          previous = taken[0];
        }
        next += skippedCount;
      }
      continue;
    }
    let target: Target | undefined;
    let fighter: Target | undefined;
    const count = effectTargetCount(effect);
    if (
      (effect.op === "Fight" || effect.op === "Bite") &&
      effect.fighter === "it"
    )
      fighter = previous;
    if (effect.op === "GrantKeyword" && effect.target === "it") {
      // No legal previous target: the grant does nothing (CR 608.2b).
      if (!previous) continue;
      target = previous;
    }
    if (effect.op === "SearchLibrary" && effect.who === "target_controller") {
      // "That land's controller may search ...": nobody searches when the
      // earlier target was illegal (CR 608.2b).
      if (!previous) continue;
      target = previous;
    }
    if (count > 0) {
      // CR 702.32 — Kicker-replacement shape: an `if_kicked: true` effect
      // that comes right after a base effect (`if_kicked: false`) shares
      // the base effect's chosen target (the "deals 4 instead" pattern,
      // Burst Lightning). The base consumes the target slot when it
      // runs (or, when the base was skipped because the cast WAS kicked,
      // records the slot in `previous` so the kicked variant can find
      // it). The kicked variant reuses the base's target without taking
      // a second slot of its own — a script only declares the targets
      // the caster actually chose (#2564). Non-kicker effects always
      // take a fresh slot from the targets list.
      const inheritPrevious =
        effect.if_kicked === true && previous !== undefined;
      if (inheritPrevious) {
        target = previous;
        if (count === 2) fighter = previous;
        // Kicker's "instead" is not its own target — the caster only
        // chose one target for the spell, and the engine reuses it.
        // `next` was already advanced by the (skipped or run) base.
      } else {
        const taken = targets.slice(next, next + count);
        next += count;
        const ctxForLegality: EffectContext = {
          controllerId: stackObject.controllerId as PlayerId,
          sourceId: (stackObject.sourceCardId as CardInstanceId) || undefined,
          kickerBonus,
          wasKicked,
          x,
          triggeringStackObjectId: stackObject.triggeringStackObjectId,
        };
        const legal =
          taken.length === count &&
          taken.every((t) =>
            effectTargetLegal(current, t, effect, ctxForLegality),
          );
        previous = legal ? taken[0] : undefined;
        if (!legal) continue;
        target = taken[count - 1];
        if (count === 2) fighter = taken[0];
      }
    }
    current = applyEffect(current, effect, {
      controllerId: stackObject.controllerId as PlayerId,
      sourceId: (stackObject.sourceCardId as CardInstanceId) || undefined,
      target,
      fighter,
      kickerBonus,
      wasKicked,
      x,
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
 * The synthetic ETB trigger an Equipment with `attachOnEnter: true` adds
 * to its scripted trigger list (#2561). The text is matched by
 * `getScriptedAbility`, so the resolver recognizes the stack object as
 * scripted and routes the `AttachEquipment` op. The same text is used by
 * `getScriptedTriggeredAbilities` in `abilities/parse.ts` when emitting
 * the parsed ability.
 */
const EQUIPMENT_ATTACH_ON_ENTER: ScriptedTrigger = {
  text: EQUIPMENT_ATTACH_ON_ENTER_TEXT,
  event: "etb",
  subject: "self",
  effects: [{ op: "AttachEquipment", target: "creature", controller: "you" }],
};

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
    stackObject.triggered
      ? (script.triggers ?? []).concat(
          script.equipment?.attachOnEnter ? [EQUIPMENT_ATTACH_ON_ENTER] : [],
        )
      : (script.activated ?? []).concat(
          script.equipment?.equip ? [script.equipment.equip] : [],
        );
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
