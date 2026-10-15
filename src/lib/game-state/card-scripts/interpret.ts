/**
 * Applies a card script's effects to the game state.
 *
 * Each effect reuses the engine's existing resolution helpers, so a scripted
 * card behaves exactly like the hand-written paths do today; the script only
 * replaces the step of reading oracle text to decide what happens.
 */
import { earthbend } from "../keyword-actions/earthbend";
import { faceCardData } from "../keyword-actions/transform";
import type {
  CardInstance,
  CardInstanceId,
  GameState,
  PlayerId,
  StackObject,
  Target,
  WaitingChoice,
  Zone,
} from "../types";
import { hasSubtype } from "../spell-casting/affinity";
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
  sacrificeCard,
} from "../keyword-actions/removal";
import { loseLife } from "../player-actions";
import { discardCards } from "../keyword-actions/draw";
import { tapCardAction, untapCardAction } from "../keyword-actions/damage-tap";
import {
  addCardToZone,
  millCards,
  moveCardBetweenZones,
  shuffleLibraryZone,
  shuffleZone,
} from "../zones";
import { startDiscard } from "../keyword-actions/discard-choice";
import { addCounters, createCardInstance, isCreature } from "../card-instance";
import { getEffectivePower } from "../evergreen-keywords";
import type { ScryfallCard } from "../types";
import {
  addUntilEndOfTurnKeywords,
  animateUntilEndOfTurn,
} from "../pt-until-end-of-turn";
import { copySpellOnStack } from "../spell-casting/resolve";
import { attachEquipment } from "../keyword-actions/equip";
import {
  addUntilEndOfTurnKeyword,
  CANT_BE_BLOCKED,
} from "../pt-until-end-of-turn";
import { getCardScript } from "./registry";
import { addMana } from "../mana/mana-pool";
import { spendMana } from "../mana/mana-payment";
import { PREDEFINED_TOKENS } from "./predefined-tokens";
import {
  matchesController,
  matchesRemovalFilter,
  REMOVAL_ALL_TARGETS,
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
  /**
   * Wave 4.8 follow-up 12 lane 87 (#2614 follow-up): the trigger's
   * `drawingPlayerId` for `event: "drawCard"` triggers, propagated
   * from `stackObject.triggerContext` set by `checkTriggeredAbilities`.
   * Read by `LoseLife.who: "drawer"` to route the loss to whoever drew.
   * Undefined for non-drawCard triggers and for direct spell / activated
   * ability contexts.
   */
  drawingPlayerId?: PlayerId;
  /**
   * Wave 4.8 follow-up 12 lane 92 (#2614 follow-up): the trigger's
   * `enteringCardId` for `event: "etb"` triggers (Drogskol Reaver's
   * "Whenever a creature you control enters, if its mana value is
   * 4 or greater, you gain life equal to its toughness"). The
   * entering creature's id is propagated from
   * `stackObject.triggerContext.enteringCardId` (set by
   * `checkTriggeredAbilities`) into the EffectContext. Read by
   * `GainLife.amount.X: "toughness"` (and any future
   * `X: "power" | "mana_value" | "creatures"` arm) to read the
   * entering creature's printed `cardData` fields. Undefined for
   * non-ETB triggers and for direct spell / activated ability
   * contexts.
   */
  enteringCardId?: CardInstanceId;
}

/**
 * CR 707.10: copy the spell that triggered this ability, keeping its
 * targets. "Those spells gain ..." marks the original and the copy. Does
 * nothing when the spell has left the stack (countered or resolved).
 *
 * `newTargets: true` (Wave 4.8 follow-up 6 lane 73, #2614 follow-up)
 * marks the engine's intent to retarget the copy per CR 707.10d. The
 * v1 pipeline has no player-facing retarget UI, so the copy still
 * inherits the original's targets; the flag is a forward-compatible
 * signal that the engine acknowledged the "you may choose new targets"
 * clause. A future pass can supply the chosen list as a 4th argument
 * and `copySpellOnStack(state, sourceId, newTargets)` will pick it up
 * (CR 707.10d — the substrate already accepts it).
 */
function copyTriggeringSpell(
  state: GameState,
  gain: readonly string[],
  newTargets: boolean,
  ctx: EffectContext,
): GameState {
  const spellId = ctx.triggeringStackObjectId;
  if (!spellId || !state.stack.some((o) => o.id === spellId)) return state;
  // Wave 4.8 follow-up 6 lane 73 (#2614 follow-up): the
  // `newTargets` flag is threaded through to `copySpellOnStack` so
  // a future lane can supply chosen retargets. v1 minimum: no
  // chosen targets are surfaced (the player-facing retarget UI is
  // a follow-up lane), so the copy inherits the original's targets
  // — matching the existing `copySpellOnStack` behaviour when
  // `newTargets` is `undefined`. The `newTargets` parameter is
  // read here (intentionally unused in v1) to make the wiring
  // explicit and so a future lane can supply a `Target[]` list
  // without re-touching the call site.
  //
  // The `if (newTargets)` check below is a no-op in v1 but keeps
  // the flag referenced (TypeScript / eslint) and acts as a
  // marker for the future retarget UI to fill in.
  const _newTargetsFlag = newTargets;
  void _newTargetsFlag;
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
  // #2594 follow-up: Exile with `fromZone: "graveyard"` (Soul-Guide
  // Lantern, Ambush Wolf) targets a card in the controller's
  // graveyard; legality checks that exact zone membership.
  if (effect.op === "Exile" && effect.fromZone === "graveyard") {
    if (target.type !== "card") return false;
    const card = state.cards.get(target.targetId as CardInstanceId);
    if (!card) return false;
    const ownerId: PlayerId = card.ownerId || card.controllerId;
    const gy = state.zones.get(`${ownerId}-graveyard`);
    if (!gy || !gy.cardIds.includes(target.targetId as CardInstanceId)) {
      return false;
    }
    return true;
  }
  // #2594 follow-up (lane 14): "exile each card in target player's
  // graveyard" (Angel of Finality) doesn't read the targeted
  // object — the engine reads `effect.controller` directly and
  // sweeps the chosen player's graveyard. Returning true keeps the
  // dispatcher's legality check happy, but the actual sweep uses
  // `effect.controller` and ignores `target`.
  if (
    effect.op === "Exile" &&
    (effect.fromZone === "opponent_graveyard" ||
      effect.fromZone === "library_top")
  ) {
    return true;
  }
  // #2594 follow-up (lane 13): "Counter target red or green spell"
  // (Flashfreeze) — the targeted spell's source card must have at
  // least one color in the script's `colors` filter. The spell is
  // a stack object; its colors come from the underlying source
  // card's color identity. A spell whose source card has no
  // colors (e.g. a colorless artifact spell) is not legal.
  if (effect.op === "Counter" && effect.colors && effect.colors.length > 0) {
    if (target.type !== "stack") return false;
    const so = state.stack.find((o) => o.id === target.targetId);
    if (!so) return false;
    const sourceCard = so.sourceCardId
      ? state.cards.get(so.sourceCardId as CardInstanceId)
      : undefined;
    const cardData = sourceCard?.cardData;
    const identity: string[] = cardData?.color_identity ?? [];
    const matches = effect.colors.some((c) => identity.includes(c));
    return matches;
  }
  return targetStillLegal(state, target);
}

/**
 * Link a card a scripted source just exiled to that source when its script
 * counts "cards exiled with" it (#2614 Keen-Eyed Curator, CR 607.2a).
 */
function linkExiledCard(
  state: GameState,
  cardId: CardInstanceId,
  ctx: EffectContext,
): GameState {
  if (!ctx.sourceId) return state;
  const source = state.cards.get(ctx.sourceId);
  if (!source || !getCardScript(source.cardData.name)?.exiled_types_bonus) {
    return state;
  }
  const card = state.cards.get(cardId);
  if (!card) return state;
  const cards = new Map(state.cards);
  cards.set(cardId, {
    ...card,
    exiledWith: {
      sourceId: source.id,
      timestamp: source.enteredBattlefieldTimestamp,
    },
  });
  return { ...state, cards };
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
 * Discard every card in the given player's hand (#2594 follow-up,
 * lane 15). Used by `Discard.all: true` (Myojin of Night's Reach).
 * Returns the `KeywordActionResult` from `discardCards` so callers
 * can chain cleanly.
 */
function discardEntireHand(state: GameState, playerId: PlayerId) {
  const hand = state.zones.get(`${playerId}-hand`);
  const count = hand?.cardIds.length ?? 0;
  return discardCards(state, playerId, count, false);
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

/** Nonbasic lands a player controls (CR 205.4a). */
function nonbasicLandCount(state: GameState, playerId: PlayerId): number {
  const zone = state.zones.get(`${playerId}-battlefield`);
  let n = 0;
  for (const id of zone?.cardIds ?? []) {
    const card = state.cards.get(id);
    if (!card || card.controllerId !== playerId) continue;
    const typeLine = card.cardData.type_line ?? "";
    if (/\bLand\b/.test(typeLine) && !/\bBasic\b/.test(typeLine)) n++;
  }
  return n;
}

function treasureCount(state: GameState, playerId: PlayerId): number {
  const zone = state.zones.get(`${playerId}-battlefield`);
  let n = 0;
  for (const id of zone?.cardIds ?? []) {
    const card = state.cards.get(id);
    if (!card || card.controllerId !== playerId) continue;
    if (/\bTreasure\b/.test(card.cardData.type_line ?? "")) n++;
  }
  return n;
}

function artifactCount(state: GameState, playerId: PlayerId): number {
  const zone = state.zones.get(`${playerId}-battlefield`);
  let n = 0;
  for (const id of zone?.cardIds ?? []) {
    const card = state.cards.get(id);
    if (!card || card.controllerId !== playerId) continue;
    if (/\bArtifact\b/.test(card.cardData.type_line ?? "")) n++;
  }
  return n;
}

/**
 * Wave 4.8 follow-up 12 lane 90 (#2614 follow-up) + follow-up 13
 * lanes 94 + 95 (#2614 follow-up): resolve a `Draw.amount`
 * from state when the `X` arm is set.
 *   - `creaturesDiedThisTurn`: boolean
 *     `state.turn.creatureDiedThisTurn` for 0 or 1
 *     (Needletooth Pack).
 *   - `cardsDrawnThisTurn`: integer
 *     `state.players[controllerId].cardsDrawnThisTurn`
 *     (Proft's Eidetic Memory's "draw N where N = cards drawn
 *     this turn" — the lane 87 `recordCardsDrawn` helper
 *     already maintains the per-player counter; lane 94
 *     just reads it).
 *   - `cardsDrawnThisTurnByOpponents`: sum of the
 *     per-opponent counters — every player EXCEPT the
 *     controller — across all opponents
 *     (Rhystic Study's "draw N where N = cards drawn by
 *     opponents this turn" — lane 95). A 3-player game
 *     has 2 opponents; the sum is across both.
 *
 * When `X` is not set, the integer `amount` (which may
 * itself be `number | "X"` — "X" here falls back to 0
 * per the existing CR 107.3 default) is returned as-is.
 */
function resolveDrawAmount(
  state: GameState,
  effect: {
    amount: number | "X";
    X?:
      | "creaturesDiedThisTurn"
      | "cardsDrawnThisTurn"
      | "cardsDrawnThisTurnByOpponents";
  },
  controllerId?: PlayerId,
): number {
  if (effect.X === "creaturesDiedThisTurn") {
    return state.turn.creatureDiedThisTurn === true ? 1 : 0;
  }
  if (effect.X === "cardsDrawnThisTurn") {
    if (!controllerId) return 0;
    return state.players.get(controllerId)?.cardsDrawnThisTurn ?? 0;
  }
  if (effect.X === "cardsDrawnThisTurnByOpponents") {
    if (!controllerId) return 0;
    let sum = 0;
    for (const [pid, p] of state.players) {
      if (pid === controllerId) continue;
      sum += p.cardsDrawnThisTurn ?? 0;
    }
    return sum;
  }
  return typeof effect.amount === "number" ? effect.amount : 0;
}

/**
 * Wave 4.8 follow-up 13 lane 97 (#2614 follow-up): resolve a
 * `CreateToken.count` from state when the `X` arm is set
 * (Redcap-style "create X 1/1 red Goblin creature tokens" —
 * the X-counts scale with the board state).
 *   - `cardsDrawnThisTurn`: integer
 *     `state.players[controllerId].cardsDrawnThisTurn`
 *     (same as `Draw.X: "cardsDrawnThisTurn"`, lane 94).
 *   - `creaturesDiedThisTurn`: boolean
 *     `state.turn.creatureDiedThisTurn` for 0 or 1
 *     (same as `Draw.X: "creaturesDiedThisTurn"`, lane 90).
 *   - `yourCreatures`: integer — the number of creatures
 *     the controller controls on the battlefield
 *     (Redcap-style X-count that scales with the
 *     controller's board).
 *
 * When `X` is not set, the integer `count` is
 * returned as-is. `xCount` permits the literal "X"
 * (CR 107.3 default of 0), which falls through to 0.
 */
function resolveCreateTokenAmount(
  state: GameState,
  effect: {
    count: number | "X";
    X?: "cardsDrawnThisTurn" | "creaturesDiedThisTurn" | "yourCreatures";
  },
  controllerId?: PlayerId,
): number {
  if (effect.X === "creaturesDiedThisTurn") {
    return state.turn.creatureDiedThisTurn === true ? 1 : 0;
  }
  if (effect.X === "cardsDrawnThisTurn") {
    if (!controllerId) return 0;
    return state.players.get(controllerId)?.cardsDrawnThisTurn ?? 0;
  }
  if (effect.X === "yourCreatures") {
    if (!controllerId) return 0;
    let count = 0;
    for (const [cardId, card] of state.cards) {
      if (card.controllerId !== controllerId) continue;
      // Parallel to `countControlledByType` in
      // `evaluate.ts` but counts ALL creatures (any
      // type_line that includes "creature").
      const typeLine = (card.cardData.type_line ?? "").toLowerCase();
      if (!typeLine.includes("creature")) continue;
      // Only count cards on the battlefield.
      if (!card.currentZoneKey?.endsWith("-battlefield")) continue;
      count += 1;
    }
    return count;
  }
  return typeof effect.count === "number" ? effect.count : 0;
}

/**
 * Wave 4.8 follow-up 12 lane 92 (#2614 follow-up): resolve a
 * `GainLife.amount` from state when the `X` arm is set
 * (Drogskol Reaver's "you gain life equal to its toughness" —
 * the entering creature's printed `cardData.toughness` becomes
 * the life-gain amount). v1 supports a single shape:
 * `toughness` reads `state.cards[ctx.enteringCardId]` — the
 * entering creature's id is on the `EffectContext` (set via
 * the trigger's `triggerContext.enteringCardId`). Falls back
 * to the integer `amount` (which may be `number | "X"` —
 * "X" here falls back to 0 per the existing CR 107.3 default)
 * when `X` is not set.
 */
function resolveGainLifeAmount(
  state: GameState,
  effect: { amount: number | "X"; X?: "toughness" },
  ctx: { enteringCardId?: CardInstanceId },
): number {
  if (effect.X === "toughness") {
    const enteringId = ctx.enteringCardId;
    if (!enteringId) {
      return typeof effect.amount === "number" ? effect.amount : 0;
    }
    const entering = state.cards.get(enteringId);
    if (!entering) {
      return typeof effect.amount === "number" ? effect.amount : 0;
    }
    const toughness = parseInt(
      entering.cardData.toughness ?? "0",
      10,
    );
    return Number.isFinite(toughness) ? toughness : 0;
  }
  return typeof effect.amount === "number" ? effect.amount : 0;
}

/**
 * The defending player for an attacking source (CR 506.2): the player it
 * attacks, or the controller of the planeswalker it attacks. Falls back to
 * the first opponent when the source is not in combat.
 */
function defendingPlayerOf(
  state: GameState,
  sourceId: CardInstanceId | undefined,
  controllerId: PlayerId,
): PlayerId | undefined {
  const attack = state.combat?.attackers?.find((a) => a.cardId === sourceId);
  if (attack) {
    if (state.players.has(attack.defenderId as PlayerId))
      return attack.defenderId as PlayerId;
    const pw = state.cards.get(attack.defenderId as CardInstanceId);
    if (pw) return pw.controllerId;
  }
  return opponentsOf(state, controllerId)[0];
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
      : effect.fighter === "enchanted"
        ? ctx.sourceId
          ? (state.cards.get(ctx.sourceId)?.attachedToId ?? undefined)
          : undefined
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
  if (
    (effect.fighter === "it" || effect.fighter === "creature") &&
    fighter.controllerId !== ctx.controllerId
  )
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
        ...(entersTapped && effect.stun
          ? {
              counters: [
                ...inst.counters.filter((c) => c.type !== "stun"),
                { type: "stun", count: effect.stun },
              ],
            }
          : {}),
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
      if (effect.target === "each_player") {
        // CR 101.4: each player in APNAP order, active player first.
        let next = state;
        const ids = [...state.players.keys()];
        const first = Math.max(0, ids.indexOf(state.turn.activePlayerId));
        for (const pid of [...ids.slice(first), ...ids.slice(0, first)]) {
          const amount =
            effect.per === "nonbasic_land"
              ? effect.amount * nonbasicLandCount(next, pid)
              : effect.amount;
          if (amount > 0) next = damagePlayer(next, amount, pid, ctx);
        }
        return next;
      }
      if (effect.target === "defending_player") {
        const defender = defendingPlayerOf(state, sourceId, ctx.controllerId);
        if (!defender) return state;
        const amount =
          effect.per === "artifact"
            ? effect.amount * artifactCount(state, defender)
            : effect.amount;
        return amount > 0 ? damagePlayer(state, amount, defender, ctx) : state;
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
      const baseAmount =
        ctx.wasKicked && effect.kickedAmount !== undefined
          ? effect.kickedAmount
          : effect.amount;
      const damageAmount =
        effect.per === "treasure"
          ? baseAmount * treasureCount(state, ctx.controllerId)
          : baseAmount;
      if (effect.per === "treasure" && damageAmount <= 0) return state;
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
      // Wave 4.8 follow-up 12 lane 90 (#2614 follow-up): when
      // `X: "creaturesDiedThisTurn"` is set, the engine reads the
      // boolean `state.turn.creatureDiedThisTurn` (Needletooth
      // Pack's "draw N cards where N = creatures that died this
      // turn" — v1 minimum is the boolean, 0 or 1; the count ledger
      // is a follow-up lane). The integer `amount` is ignored when
      // `X` is set.
      //
      // Wave 4.8 follow-up 13 lane 94 (#2614 follow-up): when
      // `X: "cardsDrawnThisTurn"` is set, the engine reads the
      // integer `state.players[controllerId].cardsDrawnThisTurn`
      // counter (Proft's Eidetic Memory). The controller is
      // `ctx.controllerId` for a normal scripted trigger; for
      // an `each_player` Draw, the helper falls through to the
      // global default (the helper handles the `each_player`
      // fan-out below).
      const drawAmount = resolveDrawAmount(
        state,
        effect,
        ctx.controllerId,
      );
      // #2594 lane 25: each_player (Scrawling Crawler, FDN).
      if (effect.who === "each_player") {
        let next = state;
        for (const pid of state.players.keys()) {
          const r = resolveCardDrawEffect(
            next,
            sourceId ?? ("unknown" as CardInstanceId),
            drawAmount,
            pid,
          );
          if (r.success) next = r.state;
        }
        return next;
      }
      const player = playerFor(effect.who, ctx);
      if (!player) return state;
      const r = resolveCardDrawEffect(
        state,
        sourceId ?? ("unknown" as CardInstanceId),
        drawAmount,
        player,
      );
      return r.success ? r.state : state;
    }
    case "AddMana": {
      // A single fixed color resolves here: a triggered or spell "add
      // {R}" (#2565). Activated mana abilities never reach the stack
      // (CR 605.3a); with a color choice ("any", or "{R} or {G}") they
      // go through the mana ability path, which asks for the color.
      // #2594 follow-up, Wave 4.7 lane 41: `"chosen"` (Heraldic
      // Banner) is rejected here — the spell/triggered path doesn't
      // have access to the source's `chosenColor`; the activated
      // mana path handles the sentinel via
      // `substituteChosenColorInEffect` in `abilities/mana.ts`.
      if (effect.colors === "any") return state;
      if (effect.colors.length !== 1) return state;
      if (effect.colors[0] === "chosen") return state;
      return addMana(state, ctx.controllerId, {
        [MANA_POOL_KEY[effect.colors[0]]]: effect.amount,
      });
    }
    case "GainLife": {
      // Wave 4.8 follow-up 12 lane 92 (#2614 follow-up): when
      // `X: "toughness"` is set, the engine reads the entering
      // creature's `cardData.toughness` (Drogskol Reaver's
      // "you gain life equal to its toughness"). The integer
      // `amount` is ignored when `X` is set; the trigger's
      // `triggerContext` (carried on the stack object via
      // `stackObject.triggerContext` and threaded into the
      // EffectContext in `resolveScriptedEffects`) provides
      // `enteringCardId` for the read.
      const lifeAmount = resolveGainLifeAmount(state, effect, ctx);
      const player = playerFor(effect.who, ctx);
      if (!player) return state;
      const r = resolveLifeGainEffect(state, sourceId, lifeAmount, player);
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
      // Wave 4.8 follow-up 12 lane 87 (#2614 follow-up):
      // "Whenever an opponent draws a card, that player loses 1 life."
      // Route the life loss to the player whose draw triggered the
      // ability (CR 121.2). Falls back to the active player when
      // the context is missing (defensive against non-drawCard
      // callers, though the schema gates "drawer" to drawCard arms).
      if (effect.who === "drawer") {
        const drawer = ctx.drawingPlayerId ?? state.turn.activePlayerId;
        const r = resolveLifeLossEffect(
          state,
          sourceId,
          effect.amount,
          drawer,
        );
        return r.success ? r.state : state;
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
      // Wave 4.8 follow-up 4 lane 66 (#2614 follow-up): the
      // embedded static arm of `CreateTokenSchema`. The keywords
      // (when present) are routed into the token's per-instance
      // `embeddedStaticKeywords` ledger (read by `hasKeyword` as
      // an additional source alongside `cardData.keywords`); the
      // P/T bonus is folded into the base P/T at token creation
      // time inside `resolveTokenCreationEffect`. The
      // token-creator's effect pays the cost at resolution; the
      // P/T + keywords are baked into the new `CardInstance`.
      const embeddedKeywords = effect.embedded_static?.keywords?.map(
        (k) => k.charAt(0).toUpperCase() + k.slice(1),
      );
      // Wave 4.8 follow-up 13 lane 97 (#2614 follow-up): the
      // `X` arm resolves the token count from state
      // (Redcap-style X-count that scales with the board).
      // The integer `count` is ignored when `X` is set.
      const tokenCount = resolveCreateTokenAmount(
        state,
        effect,
        ctx.controllerId,
      );
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
          embeddedStaticKeywords: embeddedKeywords,
        },
        tokenCount,
        ctx.controllerId,
        effect.embedded_static?.power,
        effect.embedded_static?.toughness,
      );
      return r.success ? r.state : state;
    }
    case "CreatePredefinedToken": {
      const creator =
        effect.who === "opponent"
          ? opponentsOf(state, ctx.controllerId)[0]
          : ctx.controllerId;
      if (!creator) return state;
      if (effect.if_behold && !canBehold(state, creator, effect.if_behold))
        return state;
      const r = resolveTokenCreationEffect(
        state,
        sourceId,
        PREDEFINED_TOKENS[effect.token],
        effect.count,
        creator,
      );
      if (!r.success) return state;
      if (!effect.tapped || !r.affectedCards?.length) return r.state;
      const cards = new Map(r.state.cards);
      for (const id of r.affectedCards) {
        const card = cards.get(id as CardInstanceId);
        if (card) cards.set(card.id, { ...card, isTapped: true });
      }
      return { ...r.state, cards };
    }
    case "CopyPermanent": {
      // Wave 4.8 follow-up 5 lane 70 (#2614 follow-up): "Create
      // a permanent that copies the characteristics of [a
      // target permanent on the battlefield]" (Clone,
      // Phantasmal Image, Vesuvan Doppelganger). The new
      // permanent inherits the target's `cardData` (name,
      // mana cost, type line, P/T, keywords, oracle text,
      // colors) — i.e. "all characteristics copied"
      // semantics (CR 707.2). The new permanent enters the
      // battlefield under the spell's controller; the target
      // is unchanged. The v1 minimum supports a single
      // target of any kind (`target: "permanent"`); the
      // controller narrows the source's controller when
      // set. When no explicit target is chosen (the engine
      // auto-pick path — the simplest v1 minimum), the
      // engine finds the first matching permanent on the
      // battlefield (any player's, ordered by APNAP).
      //
      // Out of scope (each a follow-up lane): "may become a
      // copy until end of turn" (Sakashima-style / manifested
      // / disposition-of-copy), "may copy a spell on the
      // stack" (Splice), "may copy a card in a graveyard"
      // (reanimation), "copied characteristics except for
      // [X]" (Phyrexian Metamorph), and "named-copy" /
      // "choose-creature-type-copy" filters.
      const matchTargetType = (
        typeLine: string,
        want: string,
      ): boolean => {
        const lower = typeLine.toLowerCase();
        if (want === "permanent") return true;
        if (want === "creature") return lower.startsWith("creature");
        if (want === "artifact")
          return (
            lower.startsWith("artifact") &&
            !lower.startsWith("artifact creature")
          );
        if (want === "enchantment")
          return (
            lower.startsWith("enchantment") &&
            !lower.startsWith("enchantment creature")
          );
        if (want === "land") return lower.startsWith("land");
        return true;
      };
      const matchController = (
        cardControllerId: PlayerId,
      ): boolean => {
        if (!effect.controller || effect.controller === "any") return true;
        const wantsYou = effect.controller === "you";
        return wantsYou
          ? cardControllerId === ctx.controllerId
          : cardControllerId !== ctx.controllerId;
      };
      // Find the target: either the chosen target on the
      // stack object, or the first matching permanent on the
      // battlefield (APNAP-ordered).
      let sourceId: CardInstanceId | undefined;
      if (target && target.type === "card") {
        sourceId = target.targetId as CardInstanceId;
        const sourceCard = state.cards.get(sourceId);
        if (
          !sourceCard ||
          !isOnBattlefield(state, sourceId) ||
          !matchTargetType(sourceCard.cardData.type_line ?? "", effect.target) ||
          !matchController(sourceCard.controllerId)
        ) {
          sourceId = undefined;
        }
      }
      if (!sourceId) {
        // Auto-pick: iterate battlefields APNAP, find the
        // first matching permanent.
        const orderedPlayers = (() => {
          const ids = [...state.players.keys()];
          const activeIdx = ids.indexOf(state.turn.activePlayerId);
          if (activeIdx < 0) return ids;
          return [...ids.slice(activeIdx), ...ids.slice(0, activeIdx)];
        })();
        outer: for (const pid of orderedPlayers) {
          const bf = state.zones.get(`${pid}-battlefield`);
          if (!bf) continue;
          for (const id of bf.cardIds) {
            const inst = state.cards.get(id);
            if (!inst) continue;
            if (
              matchTargetType(inst.cardData.type_line ?? "", effect.target) &&
              matchController(inst.controllerId)
            ) {
              sourceId = id;
              break outer;
            }
          }
        }
      }
      if (!sourceId) return state;
      const sourceCard = state.cards.get(sourceId);
      if (!sourceCard) return state;
      // Copy the cardData shallow. The new permanent carries
      // the same `cardData` reference as the source; that's
      // fine for read-only fields (name, mana_cost, type_line,
      // P/T, keywords, oracle_text, colors) which never
      // mutate. Per-instance fields (counters, attachedTo,
      // etc.) start fresh.
      const copiedCardData = { ...sourceCard.cardData };
      const controllerId = ctx.controllerId;
      const ownerId = controllerId;
      const cardIdNew = `copyperm-${Date.now()}-${Math.random().toString(36).slice(2, 11)}` as CardInstanceId;
      // Build the new CardInstance via createCardInstance so
      // we get all the defaults (summoning sickness, counters,
      // attachedTo, etc.).
      const newInstance = createCardInstance(
        copiedCardData as ScryfallCard,
        ownerId,
        controllerId,
        {
          id: cardIdNew,
          currentZoneKey: `${controllerId}-battlefield`,
        },
      );
      const newCards = new Map(state.cards);
      newCards.set(cardIdNew, newInstance);
      const bfKey = `${controllerId}-battlefield`;
      const bf = state.zones.get(bfKey);
      if (!bf) return state;
      const newZones = new Map(state.zones);
      newZones.set(bfKey, {
        ...bf,
        cardIds: [...bf.cardIds, cardIdNew],
      });
      return {
        ...state,
        cards: newCards,
        zones: newZones,
        lastModifiedAt: Date.now(),
      };
    }
    case "CopyUntilEndOfTurn": {
      // Wave 4.8 follow-up 8 lane 75a (#2614 follow-up):
      // "create a token that's a copy of [a chosen permanent]
      // until end of turn" (Cackling Counterpart). The spell
      // creates a NEW `CardInstance` whose printed `cardData`
      // is the chosen permanent's cardData (CR 707.2 "all
      // characteristics copied" — name, type_line, power,
      // toughness, colors, color_identity, keywords) and
      // stamps the new card with `animatedUntilEndOfTurn`
      // (carrying the SPELL's printed `cardData`) and
      // `copyOfTargetId` (carrying the chosen permanent's id).
      // The existing lane 75 rollback paths
      // (`clearUntilEndOfTurnPT` + `restoreAnimatedOffBattlefield`)
      // restore the SPELL's printed `cardData` at end of
      // turn or when the new card / chosen permanent leaves
      // the battlefield. v1 single chosen target, "all
      // characteristics copied" semantics, "until end of
      // turn" duration.
      //
      // The chosen target must be on the battlefield at
      // resolution time — if the target has left the
      // battlefield (the player chose a then-tapped, then-
      // destroyed permanent, etc.), the spell fizzles and no
      // token is created. The chosen target itself is
      // unchanged; the new card is stamped under the
      // spell's controller.
      //
      // Distinct from lane 70's `CopyPermanent` op (the
      // `CopyPermanent` op creates a permanent copy with no
      // EOT rollback; lane 75a creates one that rolls back
      // at end of turn via the lane 75 infrastructure) and
      // distinct from lane 75's `StaticSchema.become_copy`
      // static (the static copies an existing in-play
      // permanent onto itself; the static itself pre-exists
      // the copy. Lane 75a creates a NEW permanent; the
      // permanent itself is the copy).
      const chosenId = effect.chosen_permanent as CardInstanceId;
      const chosenCard = state.cards.get(chosenId);
      if (!chosenCard) return state;
      if (!chosenCard.currentZoneKey?.endsWith("-battlefield")) return state;
      // Stamp the chosen target's printed `cardData` onto
      // the new permanent. The overlay covers the v1
      // "all characteristics copied" surface (name,
      // type_line, power, toughness, colors,
      // color_identity, keywords). The new permanent's
      // printed `cardData` is captured under
      // `animatedUntilEndOfTurn` so the lane 75 rollback
      // paths restore it at EOT or when the new permanent
      // leaves the battlefield.
      const chosenPrintedCardData = chosenCard.cardData;
      const controllerId = ctx.controllerId;
      const ownerId = controllerId;
      const cardIdNew = `copyeot-${Date.now()}-${Math.random().toString(36).slice(2, 11)}` as CardInstanceId;
      // Build the new CardInstance with the chosen target's
      // printed characteristics, mirroring lane 70's
      // `createCardInstance + zone push` flow so the new
      // permanent enters the battlefield with the standard
      // defaults (summoning sickness, counters, attachedTo,
      // etc.). The spell's own script provides the printed
      // cardData via the stack object's source; the chosen
      // target's characteristics are stamped via
      // `animatedUntilEndOfTurn` so the rollback paths
      // (which read `animatedUntilEndOfTurn.cardData`) find
      // the spell's printed cardData.
      const spellSourceData = state.cards.get(
        ctx.sourceId ?? ("" as CardInstanceId),
      );
      // Fallback: if the spell's source isn't resolvable,
      // use the chosen target's cardData as both the printed
      // and the overlaid (the overlay is a no-op when both
      // are the same — the rollback paths self-correct).
      const printed = spellSourceData?.cardData ?? chosenPrintedCardData;
      const newInstance = createCardInstance(
        {
          ...printed,
          name: chosenPrintedCardData.name,
          type_line: chosenPrintedCardData.type_line,
          power: chosenPrintedCardData.power,
          toughness: chosenPrintedCardData.toughness,
          colors: chosenPrintedCardData.colors,
          color_identity: chosenPrintedCardData.color_identity,
          keywords: chosenPrintedCardData.keywords,
        } as ScryfallCard,
        ownerId,
        controllerId,
        {
          id: cardIdNew,
          currentZoneKey: `${controllerId}-battlefield`,
        },
      );
      const updatedInstance: typeof newInstance = {
        ...newInstance,
        animatedUntilEndOfTurn: {
          cardData: printed,
          // Mark the overlay as spell-effect-set so the
          // lane 75 refresh-pass drop branch preserves the
          // overlay until EOT cleanup.
          setBySpellEffect: true,
        },
        copyOfTargetId: chosenId,
      };
      const newCards = new Map(state.cards);
      newCards.set(cardIdNew, updatedInstance);
      const bfKey = `${controllerId}-battlefield`;
      const bf = state.zones.get(bfKey);
      if (!bf) return state;
      const newZones = new Map(state.zones);
      newZones.set(bfKey, {
        ...bf,
        cardIds: [...bf.cardIds, cardIdNew],
      });
      return {
        ...state,
        cards: newCards,
        zones: newZones,
        lastModifiedAt: Date.now(),
      };
    }
    case "Destroy": {
      // #2594 follow-up (lane 12): sweeper targets ("all_creatures",
      // "all_artifacts", "all_enchantments", "all_nonland_permanents")
      // iterate the battlefield instead of resolving a single target.
      // When the source's controller hasn't narrowed the sweep via
      // `controller`, every player's battlefield is affected
      // (Day of Judgment, Fumigate). Otherwise only the matching
      // controller's battlefield is swept.
      if ((REMOVAL_ALL_TARGETS as readonly string[]).includes(effect.target)) {
        let next = state;
        const controllers = new Set<PlayerId>(state.players.keys());
        if (effect.controller) {
          // Narrow: only the source's controller or its opponent.
          if (effect.controller === "you") {
            if (!ctx.controllerId) return state;
            controllers.clear();
            controllers.add(ctx.controllerId);
          } else {
            // opponent — pick the one player whose id isn't the
            // source controller (single-opponent 2-player games).
            if (!ctx.controllerId) return state;
            const opp = [...state.players.keys()].find(
              (p) => p !== ctx.controllerId,
            );
            if (!opp) return state;
            controllers.clear();
            controllers.add(opp);
          }
        }
        // Snapshot ids because `destroyCard` mutates zones.
        const ids: CardInstanceId[] = [];
        for (const playerId of controllers) {
          const zone = state.zones.get(`${playerId}-battlefield`);
          if (!zone) continue;
          for (const id of zone.cardIds) {
            const inst = next.cards.get(id);
            if (!inst) continue;
            // indestructible + regenerate shields are still respected
            // by `destroyCard`. The filter also re-checks
            // min_power/max_power for "all_creatures with power X+".
            if (matchesRemovalFilter(inst, effect)) {
              ids.push(id);
            }
          }
        }
        for (const id of ids) {
          const r = destroyCard(next, id);
          if (r.success) next = r.state;
        }
        return next;
      }
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
      // #2614 Keen-Eyed Curator: "target card from a graveyard" (graveyard
      // set) takes any card type, so the permanent filters don't apply.
      const anyCard = effect.fromZone === "graveyard" && effect.graveyard;
      // #2594 follow-up (lane 14): the opponent_graveyard sweep
      // doesn't read the targeted object — the engine reads
      // `effect.controller` directly and iterates the chosen
      // player's graveyard. Skip the target legality check
      // (handled by the sweep branch below).
      // #2594 follow-up (lane 20): the count-based graveyard
      // exile (Soul-Shackled Zombie — "exile up to N from a
      // single graveyard") does not require a target either — the
      // engine picks up to `count` ids from the chosen graveyard.
      const isSweep =
        effect.fromZone === "opponent_graveyard" ||
        effect.fromZone === "library_top" ||
        (effect.fromZone === "graveyard" &&
          effect.count !== undefined &&
          effect.count > 1);
      if (
        !isSweep &&
        (!target ||
          (!anyCard &&
            (!targetStillMatches(state, target.targetId, effect) ||
              !controllerStillMatches(
                state,
                target.targetId,
                effect.controller,
                ctx,
              ))))
      )
        return state;
      // #2594 follow-up (lane 14): "exile each card in target
      // player's graveyard" (Angel of Finality). The target
      // player is narrowed by `effect.controller` (`"you"` for the
      // controller's own graveyard, `"opponent"` for the
      // opponent's). Default behavior ("exile target player's
      // graveyard") targets the opponent.
      if (effect.fromZone === "opponent_graveyard") {
        let targetPlayer: PlayerId | undefined;
        if (effect.controller === "you") {
          targetPlayer = ctx.controllerId;
        } else {
          // opponent (default) — pick the one player whose id
          // isn't the source controller (single-opponent 2-player
          // games).
          if (!ctx.controllerId) return state;
          targetPlayer = [...state.players.keys()].find(
            (p) => p !== ctx.controllerId,
          );
        }
        if (!targetPlayer) return state;
        const gy = state.zones.get(`${targetPlayer}-graveyard`);
        if (!gy) return state;
        let next = state;
        // Snapshot ids because `exileCard` mutates zones.
        const ids: CardInstanceId[] = [...gy.cardIds];
        for (const id of ids) {
          const r = exileCard(next, id);
          if (r.success) next = r.state;
        }
        return next;
      }
      // #2594 follow-up (lane 16): "exile the top card of each
      // player's library" (Etali, Primal Storm — FDN). The engine
      // iterates every player's library, takes the top card (last
      // id in the array; libraries are drawn from the end), and
      // exiles it. Libraries with no cards are silently skipped.
      if (effect.fromZone === "library_top") {
        let next = state;
        for (const playerId of state.players.keys()) {
          const lib = state.zones.get(`${playerId}-library`);
          if (!lib || lib.cardIds.length === 0) continue;
          const topId = lib.cardIds[lib.cardIds.length - 1];
          const r = exileCard(next, topId);
          if (r.success) next = r.state;
        }
        return next;
      }
      // #2594 follow-up: "exile target card from a graveyard"
      // (Ambush Wolf, Soul-Guide Lantern). When `fromZone` is
      // "graveyard", the target is a card id in the chosen player's
      // graveyard and the engine routes through the graveyard
      // zone directly. `exileCard` already moves the card from its
      // current zone to the exile zone, so the only branch here is
      // the legality check (the chosen player must own the card
      // and the target zone must contain it).
      const targetId = target?.targetId as CardInstanceId | undefined;
      if (effect.fromZone === "graveyard") {
        // #2594 follow-up (lane 20): "exile up to N target cards from
        // a single graveyard" (Soul-Shackled Zombie — FDN #70).
        // When `count` is set on the graveyard-exile effect, the
        // engine takes up to `count` card ids from the chosen
        // graveyard and exiles them. The targeted card (if any) is
        // the first choice; remaining slots are filled from the
        // graveyard's current contents in order.
        const count = effect.count && effect.count > 1 ? effect.count : 0;
        if (count > 0) {
          let ownerId: PlayerId;
          if (targetId) {
            const card = state.cards.get(targetId);
            if (!card) return state;
            ownerId = card.ownerId || card.controllerId;
            const gy = state.zones.get(`${ownerId}-graveyard`);
            if (!gy || !gy.cardIds.includes(targetId)) {
              return state;
            }
            if (effect.graveyard === "you" && ownerId !== ctx.controllerId) {
              return state;
            }
          } else {
            // No targeted card: the drafter hints via
            // `graveyard`. "you" = controller's graveyard; "any"
            // = the opponent's (single-opponent 2-player default
            // is the other player).
            if (effect.graveyard === "you") {
              ownerId = ctx.controllerId;
            } else if (effect.graveyard === "any") {
              const opp = [...state.players.keys()].find(
                (p) => p !== ctx.controllerId,
              );
              ownerId = opp ?? ctx.controllerId;
            } else {
              ownerId = ctx.controllerId;
            }
          }
          const gy = state.zones.get(`${ownerId}-graveyard`);
          if (!gy || gy.cardIds.length === 0) return state;
          const ids: CardInstanceId[] = [];
          // Prefer the targeted card first if it's in the
          // graveyard; fall through to scanning the rest.
          if (
            targetId &&
            gy.cardIds.includes(targetId) &&
            !ids.includes(targetId)
          ) {
            ids.push(targetId);
          }
          for (const id of gy.cardIds) {
            if (ids.length >= count) break;
            if (!ids.includes(id)) ids.push(id);
          }
          let next = state;
          for (const id of ids) {
            const r = exileCard(next, id);
            if (r.success) next = r.state;
          }
          for (const id of ids) {
            next = linkExiledCard(next, id, ctx);
          }
          return next;
        }
        // Single-card branch (lane 10): when count is unset or 1,
        // route through the existing targeted exile path.
        if (!targetId) return state;
        const card = state.cards.get(targetId);
        if (!card) return state;
        const ownerId: PlayerId = card.ownerId || card.controllerId;
        const gy = state.zones.get(`${ownerId}-graveyard`);
        if (!gy || !gy.cardIds.includes(targetId)) {
          return state;
        }
        if (effect.graveyard === "you" && ownerId !== ctx.controllerId) {
          return state;
        }
        const r = exileCard(state, targetId);
        if (!r.success) return state;
        return linkExiledCard(r.state, targetId, ctx);
      }
      if (!targetId) return state;
      const r = exileCard(state, targetId);
      if (!r.success) return state;
      return linkExiledCard(r.state, targetId, ctx);
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
      // #2594 lane 27: `count: "all"` is a sweep (Raise the Past,
      // FDN #22). #2560: single-target path below.
      if (effect.count === "all") {
        const ownerId =
          (effect.filter?.controller ?? "you") === "you"
            ? ctx.controllerId
            : opponentsOf(state, ctx.controllerId)[0];
        if (!ownerId) return state;
        const gy = state.zones.get(`${ownerId}-graveyard`);
        if (!gy) return state;
        let next = state;
        for (const id of [...gy.cardIds]) {
          const card = next.cards.get(id);
          if (!card) continue;
          if (effect.filter?.creature === true && !isCreature(card)) continue;
          if (
            effect.filter?.mv_le !== undefined &&
            (card.cardData.cmc ?? 0) > effect.filter.mv_le
          )
            continue;
          const prepared =
            card.controllerId !== ctx.controllerId
              ? {
                  ...next,
                  cards: new Map(next.cards).set(id, {
                    ...card,
                    controllerId: ctx.controllerId,
                  }),
                }
              : next;
          const r = moveCardToZone(prepared, id, "battlefield");
          if (r.success) next = r.state;
        }
        return next;
      }
      if (!target) return state;
      if (!returnFromZoneStillMatches(state, target.targetId, effect, ctx))
        return state;
      const cardId = target.targetId as CardInstanceId;
      // CR 400.3: transferred control — `moveCardToZone` uses
      // `card.controllerId` to pick the destination battlefield.
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
      // #2594 follow-up (lane 22): "Counter target activated or
      // triggered ability" (Stifle — TSP #88). The script's
      // `target` enum distinguishes "spell" vs "ability"; the
      // targeted stack object's type must match. A spell targeted
      // by an ability-counter fizzles (CR 608.2b — illegal target),
      // and an ability targeted by a spell-counter likewise fizzles.
      // The target's `targetId` is the stack object id; we look up
      // the stack object directly because `target.type` is "stack"
      // for both spells and abilities.
      const stackObj = state.stack.find((o) => o.id === target.targetId);
      if (!stackObj) return state;
      const matchesType =
        (effect.target === "spell" && stackObj.type === "spell") ||
        (effect.target === "ability" && stackObj.type === "ability");
      if (!matchesType) return state;
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
      if (effect.target === "other_creatures_you_control") {
        // Untargeted fan-out (#2614 Summon: Esper Maduin chapter III).
        const battlefield = state.zones.get(`${ctx.controllerId}-battlefield`);
        let next: GameState = state;
        for (const id of battlefield?.cardIds ?? []) {
          const c = next.cards.get(id);
          if (!c || id === sourceId || !isCreature(c)) continue;
          if (c.controllerId !== ctx.controllerId) continue;
          const r = resolveEffect(
            next,
            {
              effectType: "pt_until_eot",
              power: effect.power,
              toughness: effect.toughness,
              targetId: id,
            },
            sourceId,
          );
          if (!r.success) continue;
          next = effect.keywords?.length
            ? addUntilEndOfTurnKeywords(r.state, id, effect.keywords)
            : r.state;
        }
        return next;
      }
      const cardId = creatureFor(state, effect.target, ctx, effect.controller);
      if (!cardId) return state;
      // Doubling power: +X/+0 where X is the creature's power now. A
      // negative power doubles to a lower value (CR 701.10e-style), so X is
      // the power as-is.
      const doubled = state.cards.get(cardId);
      const power = effect.double_power
        ? doubled
          ? getEffectivePower(doubled)
          : 0
        : effect.power;
      const r = resolveEffect(
        state,
        {
          effectType: "pt_until_eot",
          power,
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
      // "permanents_you_control" fans out: every permanent the
      // controller owns on resolution gets the keyword. Boros Charm
      // mode 2 ("Permanents you control gain indestructible until end
      // of turn.") is the v1 sample (#2594 #14).
      if (effect.target === "permanents_you_control") {
        const battlefieldKey = `${ctx.controllerId}-battlefield`;
        const battlefield = state.zones.get(battlefieldKey);
        if (!battlefield) return state;
        let next: GameState = state;
        const subtypes = effect.subtypes;
        for (const id of battlefield.cardIds) {
          if (subtypes) {
            const card = state.cards.get(id);
            if (!card || !subtypes.some((t) => hasSubtype(card, t))) continue;
          }
          next = addUntilEndOfTurnKeyword(next, id, effect.keyword);
        }
        return next;
      }
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
      // #2594 follow-up (lane 23): "Put X +1/+1 counters on Heroes'
      // Bane, where X is its power" (Heroes' Bane — FDN #639). When
      // `use_source_power: true`, the resolved amount is the
      // ability source's effective power at apply-time
      // (`getEffectivePower(source)`). For target: "self", source and
      // target are the same card; the source is read for its current
      // (post-layer) power, including any +1/+1 counters on it (so
      // re-activating Heroes' Bane compounds).
      const resolvedAmount = effect.use_source_power
        ? sourceId
          ? Math.max(0, getEffectivePower(state.cards.get(sourceId)!))
          : 0
        : (effect.amount ?? 0);
      const cards = new Map(state.cards);
      cards.set(cardId, addCounters(card, effect.counter, resolvedAmount));
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
      // #2594 lane 25.
      if (effect.who === "each_player") {
        let next = state;
        for (const pid of state.players.keys()) {
          next = millPlayer(next, pid, effect.amount);
        }
        return next;
      }
      const player = playerFor(effect.who, ctx);
      return player ? millPlayer(state, player, effect.amount) : state;
    }
    case "Discard": {
      // #2594 follow-up (lane 15): "Discard your hand" (Myojin of
      // Night's Reach — FDN, Nibelheim Aflame — FIN). When
      // `all: true`, the player (per `who`) discards every card
      // currently in their hand regardless of `amount`. The
      // engine's `discardCards(state, player, count)` primitive
      // already discards exactly `count` cards (and naturally
      // discards the whole hand when `count === hand.length`).
      if (effect.all) {
        if (effect.who === "each_opponent") {
          let next = state;
          for (const opp of opponentsOf(state, ctx.controllerId)) {
            const r = discardEntireHand(next, opp);
            if (r.success) next = r.state;
          }
          return next;
        }
        if (effect.who === "each_player") {
          let next = state;
          for (const pid of state.players.keys()) {
            const r = discardEntireHand(next, pid);
            if (r.success) next = r.state;
          }
          return next;
        }
        const player = playerFor(effect.who, ctx);
        if (!player) return state;
        const r = discardEntireHand(state, player);
        return r.success ? r.state : state;
      }
      if (effect.who === "each_opponent") {
        let next = state;
        for (const opp of opponentsOf(state, ctx.controllerId)) {
          next = startDiscard(next, opp, effect.amount);
        }
        return next;
      }
      // #2594 lane 25.
      if (effect.who === "each_player") {
        let next = state;
        for (const pid of state.players.keys()) {
          next = startDiscard(next, pid, effect.amount);
        }
        return next;
      }
      const player = playerFor(effect.who, ctx);
      return player ? startDiscard(state, player, effect.amount) : state;
    }
    case "CopySpell":
      return copyTriggeringSpell(
        state,
        effect.gain ?? [],
        effect.new_targets === true,
        ctx,
      );
    case "SearchLibrary":
      return searchLibrary(state, effect, ctx);
    case "Animate": {
      // #2614 Soulstone Sanctuary: the source becomes a creature until end
      // of turn; it keeps its other types ("It's still a land").
      const cardId = ctx.sourceId;
      if (!cardId || !isOnBattlefield(state, cardId)) return state;
      const animated = animateUntilEndOfTurn(state, cardId, {
        power: effect.power,
        toughness: effect.toughness,
        allCreatureTypes: effect.all_creature_types === true,
      });
      return effect.keywords
        ? addUntilEndOfTurnKeywords(animated, cardId, effect.keywords)
        : animated;
    }
    case "RevealTopToHand": {
      // The reveal itself is public information; the engine has no
      // separate reveal step. A nonpermanent card stays on top.
      const library = state.zones.get(`${ctx.controllerId}-library`);
      const top = library?.cardIds[library.cardIds.length - 1];
      const card = top ? state.cards.get(top) : undefined;
      if (!top || !card) return state;
      const typeLine = (card.cardData.type_line ?? "").split(" // ")[0];
      if (
        !/\b(artifact|creature|enchantment|land|planeswalker|battle)\b/i.test(
          typeLine,
        )
      )
        return state;
      const r = moveCardToZone(state, top, "hand");
      return r.success ? r.state : state;
    }
    case "ReturnTransformed": {
      const id = ctx.sourceId;
      const card = id ? state.cards.get(id) : undefined;
      if (!id || !card) return state;
      // Cast from a graveyard: flashback (or another graveyard cast).
      const spell = state.stack.find((o) => o.sourceCardId === id);
      const fromGraveyard = (spell?.alternativeCostsUsed ?? []).some((c) =>
        ["flashback", "harmonize", "escape"].includes(c),
      );
      if (!fromGraveyard) return state;
      if (!state.zones.get("stack")?.cardIds.includes(id)) return state;
      const original = card.transformOriginalCardData ?? card.cardData;
      if (original.layout !== "transform" || !original.card_faces?.[1])
        return state;
      // "Exile it, then put it onto the battlefield transformed under its
      // owner's control": the brief stop in exile has no other effect here,
      // so it moves straight from the stack, back face up, with the
      // finality counter on it as it enters.
      const transformed: CardInstance = {
        ...card,
        controllerId: card.ownerId,
        transformOriginalCardData: original,
        cardData: faceCardData(
          { ...card, transformOriginalCardData: original },
          1,
        ),
        currentFaceIndex: 1,
        counters: effect.counter ? [{ type: effect.counter, count: 1 }] : [],
      };
      const cards = new Map(state.cards);
      cards.set(id, transformed);
      const r = moveCardToZone({ ...state, cards }, id, "battlefield");
      return r.success ? r.state : state;
    }
    case "AddSubtype": {
      const id = ctx.sourceId;
      const card = id ? state.cards.get(id) : undefined;
      if (!id || !card || !isOnBattlefield(state, id)) return state;
      const prev = card.untilEndOfTurnSubtypes ?? [];
      if (prev.includes(effect.subtype)) return state;
      const cards = new Map(state.cards);
      cards.set(id, {
        ...card,
        untilEndOfTurnSubtypes: [...prev, effect.subtype],
      });
      return { ...state, cards };
    }
    case "Earthbend": {
      // #2614 Ba Sing Se: target land you control (CR 608.2b re-check).
      const cardId = ctx.target?.targetId as CardInstanceId | undefined;
      if (!cardId || !isOnBattlefield(state, cardId)) return state;
      if (!controllerStillMatches(state, cardId, "you", ctx)) return state;
      return earthbend(state, cardId, effect.amount);
    }
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
      | "triggerContext"
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
          drawingPlayerId:
            stackObject.triggerContext?.drawingPlayerId ?? undefined,
          enteringCardId:
            stackObject.triggerContext?.enteringCardId ?? undefined,
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
    // #2614 — "if it has N or more quest counters on it", read from the
    // source as this effect resolves (after earlier effects of the same
    // ability). A skipped effect still uses up its target slot.
    if (
      "if_source_counters" in effect &&
      effect.if_source_counters &&
      !sourceHasCounters(current, stackObject, effect.if_source_counters)
    ) {
      next += effectTargetCount(effect);
      previous = undefined;
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
          drawingPlayerId:
            stackObject.triggerContext?.drawingPlayerId ?? undefined,
          enteringCardId:
            stackObject.triggerContext?.enteringCardId ?? undefined,
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
      drawingPlayerId:
        stackObject.triggerContext?.drawingPlayerId ?? undefined,
      enteringCardId:
        stackObject.triggerContext?.enteringCardId ?? undefined,
    });
  }
  return current;
}

/**
 * Whether `playerId` can behold a `subtype`: a permanent of that subtype
 * they control, or a card of it in their hand (#2614 Sarkhan).
 */
function canBehold(
  state: GameState,
  playerId: PlayerId,
  subtype: string,
): boolean {
  for (const card of state.cards.values()) {
    if (!hasSubtype(card, subtype)) continue;
    if (card.controllerId === playerId && isOnBattlefield(state, card.id))
      return true;
    if (card.currentZoneKey === `${playerId}-hand`) return true;
  }
  return false;
}

/**
 * Whether the ability's source has at least `gate.min` counters of
 * `gate.counter` (#2614 Earthbender Ascension). A source that left the
 * battlefield is read as it is now, which drops its counters; the engine
 * does not keep last known information for this check.
 */
function sourceHasCounters(
  state: GameState,
  stackObject: ScriptStackObject,
  gate: { counter: string; min: number },
): boolean {
  const id = stackObject.sourceCardId as CardInstanceId | undefined;
  const source = id ? state.cards.get(id) : undefined;
  if (!source || !isOnBattlefield(state, source.id)) return false;
  const have = source.counters.find((c) => c.type === gate.counter)?.count ?? 0;
  return have >= gate.min;
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
 * Wave 4.8 follow-up 2 lane 60 (#2614 follow-up): a triggered
 * ability gated on `you_may: true` (CR 117.3a) produces a
 * yes/no `waitingChoice` so the controller can decline. Surfacing
 * the prompt returns the new state with `waitingChoice` set and the
 * engine's resolution machinery suspends until the player answers
 * (`resolveYouMayPrompt` in spell-casting/choices.ts).
 *
 * The same WaitingChoice type string (`you_may_prompt`) is reused
 * for any scripted "you may" trigger; the resolver looks up the
 * source trigger's `text` on the stack object to disambiguate when
 * more than one such trigger is on the stack.
 *
 * `triggerText` is the script entry's `text` (the line before the
 * colon in oracle text, e.g. "When this creature enters, you may
 * draw a card"); the prompt labels the choice with that text so the
 * UI can show the player exactly which trigger they're answering.
 */
export function createYouMayPromptWaitingChoice(
  stackObjectId: string,
  playerId: PlayerId,
  triggerText: string,
): WaitingChoice {
  return {
    type: "you_may_prompt",
    playerId,
    stackObjectId,
    prompt: `${triggerText} (you may)`,
    choices: [
      { label: "Yes", value: true, isValid: true },
      { label: "No", value: false, isValid: true },
    ],
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Wave 4.8 follow-up 12 lane 88 (#2614 follow-up): a triggered
 * ability's `cost.sacrifice_self: true` gate (CR 602.2b — "Sacrifice
 * this [permanent]:" as a trigger cost). Surfaces a yes/no
 * `sacrifice_self_prompt` WaitingChoice; the controller picks yes /
 * no. On yes, the source permanent is sacrificed BEFORE the
 * trigger's effects resolve (CR 602.2b "the cost is paid before
 * the spell or ability resolves"); on no, the trigger does nothing.
 *
 * The prompt text names the trigger and surfaces the "yes/no" choice
 * for the controller. Resolved by the `sacrifice_self_prompt`
 * branch in spell-casting/choices.ts, which stamps
 * `stackObject.cost_paid` and returns the controller to the
 * resolution path.
 */
export function createSacrificeSelfPromptWaitingChoice(
  stackObjectId: string,
  playerId: PlayerId,
  triggerText: string,
): WaitingChoice {
  return {
    type: "sacrifice_self_prompt",
    playerId,
    stackObjectId,
    prompt: `${triggerText} (sacrifice this permanent to pay the cost?)`,
    choices: [
      { label: "Yes", value: true, isValid: true },
      { label: "No", value: false, isValid: true },
    ],
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Wave 4.8 follow-up 13 lane 98 (#2614 follow-up):
 * `createDiscardPromptWaitingChoice` — surfaces a
 * yes/no prompt asking the controller to discard a
 * card as a trigger cost (Storm Fleet Spy variant —
 * parallel to {@link createSacrificeSelfPromptWaitingChoice}).
 * On yes, the engine calls `discardCards` to move
 * `amount` cards from the controller's hand to the
 * graveyard; on no, the trigger does nothing
 * (CR 602.2b). v1 uses a random-discard path; explicit
 * controller selection rides a follow-up lane.
 */
export function createDiscardPromptWaitingChoice(
  stackObjectId: string,
  playerId: PlayerId,
  triggerText: string,
  amount: number,
): WaitingChoice {
  return {
    type: "discard_prompt",
    playerId,
    stackObjectId,
    prompt:
      amount === 1
        ? `${triggerText} (discard a card to pay the cost?)`
        : `${triggerText} (discard ${amount} cards to pay the cost?)`,
    choices: [
      { label: "Yes", value: true, isValid: true },
      { label: "No", value: false, isValid: true },
    ],
    minChoices: 1,
    maxChoices: 1,
    presentedAt: Date.now(),
  };
}

/**
 * Resolve a triggered or activated ability from its source's script.
 * Returns undefined when the ability isn't scripted, so the caller falls back
 * to reading its text.
 *
 * Wave 4.8 follow-up 2 lane 60 (#2614 follow-up) extension: when the
 * scripted trigger carries `you_may: true`, the controller is
 * offered a yes/no prompt before any of the trigger's effects run.
 * If `stackObject.you_may_resolved === false`, the entire effects
 * list is skipped (the trigger fizzles silently). If undefined, the
 * prompt is surfaced and resolution is suspended — the engine's
 * usual `waitingChoice` machinery resumes it.
 *
 * Wave 4.8 follow-up 12 lane 88 (#2614 follow-up) extension: when
 * the scripted trigger carries `cost.sacrifice_self: true`, the
 * engine surfaces a `sacrifice_self_prompt` waitingChoice at
 * resolution; the controller picks yes / no. On yes, the source
 * permanent is sacrificed BEFORE the effects (CR 602.2b); on no,
 * the trigger does nothing. The `cost_paid` field on the
 * StackObject tracks the player's choice.
 */
export function resolveScriptedAbility(
  state: GameState,
  stackObject: StackObject,
): GameState | undefined {
  const ability = getScriptedAbility(state, stackObject);
  if (!ability) return undefined;
  // Lane 60 (#2614 follow-up): "you may" trigger gate.
  if (
    "you_may" in ability &&
    (ability as { you_may?: boolean }).you_may === true
  ) {
    if (stackObject.you_may_resolved === false) {
      // Controller declined: the trigger does nothing.
      return state;
    }
    if (stackObject.you_may_resolved === undefined) {
      // Surface a yes/no prompt and suspend resolution. Strip any
      // existing waitingChoice to avoid stacked prompts (each
      // resolveScriptedAbility call is a fresh top-of-stack resolve).
      return {
        ...state,
        waitingChoice: createYouMayPromptWaitingChoice(
          stackObject.id,
          stackObject.controllerId as PlayerId,
          ability.text,
        ),
      };
    }
    // you_may_resolved === true: fall through and run effects.
  }
  // Wave 4.8 follow-up 13 lane 93 (#2614 follow-up):
  // "you may pay [cost]; if you do, [effects]" gate.
  // Combines the lane 60 `you_may` yes/no prompt with a
  // cost-on-yes path (CR 117.3a "you may pay N life;
  // if you do, ..." pattern; Skyship Buccaneer is the
  // canonical example).
  //
  // The v1 minimum supports two cost shapes (parallel
  // to the lane 88 `cost` substrate):
  //   - `sacrifice_self: true` — sacrifice the source
  //     permanent. Reuses the lane 88 sacrifice-card
  //     path.
  //   - `pay_life: { amount: N }` — pay N life. Reuses
  //     the lane 63 `resolveLifeLossEffect` /
  //     `loseLife` helpers.
  //
  // Mutual exclusion with `cost` is enforced in the
  // schema (the refine rule rejects both arms on the
  // same trigger). The cost runs only when
  // `you_may_resolved === true` (the yes is the
  // consent); on `=== false` the trigger is skipped
  // by the lane 60 `you_may` gate above. The cost
  // stamps `cost_paid: true` (reusing the lane 88
  // flag — the schema guarantees `cost` and
  // `you_may_cost` are mutually exclusive, so no
  // double-stamp risk) and re-runs the effects loop.
  const youMayCost = (ability as { you_may_cost?: unknown }).you_may_cost;
  if (youMayCost !== undefined) {
    // Defensive: if the controller's `you_may` flag is
    // missing, surface the prompt (the schema's
    // refine rule already enforces `you_may: true`,
    // but a hand-written ability could miss it). This
    // mirrors the lane 60 gate.
    if (stackObject.you_may_resolved !== true) {
      // The lane 60 gate handles `=== undefined`
      // (surface prompt) and `=== false` (skip). If
      // we're here with `you_may_resolved !== true`,
      // the lane 60 gate's logic already covered the
      // case — fall through.
      // (No-op here; the lane 60 gate's return paths
      // covered undefined and false above.)
    } else {
      // `you_may_resolved === true`: pay it.
      const stackAny = stackObject as StackObject & {
        cost_paid?: boolean;
      };
      if (stackAny.cost_paid === undefined) {
        // Stamp and apply the cost in the same pass —
        // the yes/no gate has already settled the
        // controller's consent; the cost_paid flag
        // guards against double-apply on subsequent
        // resolve passes.
        if (
          typeof youMayCost === "object" &&
          youMayCost !== null &&
          "sacrifice_self" in youMayCost &&
          (youMayCost as { sacrifice_self: unknown }).sacrifice_self === true
        ) {
          // Defensive: if the source has been
          // destroyed by another effect before the
          // cost runs, the trigger fizzles (CR
          // 602.2b). Reuses the lane 88 source-
          // presence guard.
          const sourceStillPresent =
            stackObject.sourceCardId !== null &&
            state.cards.has(stackObject.sourceCardId as CardInstanceId) &&
            state.zones
              .get(`${stackObject.controllerId as PlayerId}-battlefield`)
              ?.cardIds.includes(stackObject.sourceCardId);
          if (!sourceStillPresent) {
            stackAny.cost_paid = false;
            return state;
          }
          const sacrificed = sacrificeCard(
            state,
            stackObject.sourceCardId as CardInstanceId,
          );
          if (sacrificed.success) state = sacrificed.state;
          else {
            stackAny.cost_paid = false;
            return state;
          }
        } else if (
          typeof youMayCost === "object" &&
          youMayCost !== null &&
          "pay_life" in youMayCost
        ) {
          const amount = (
            youMayCost as { pay_life: { amount: number } }
          ).pay_life.amount;
          // Pay the cost: lose N life. The helper
          // stamps the spectator's `lastTurnLifeLost`
          // for CR 702.135 spectacle. Defensive:
          // losing more life than the controller has
          // floors at 0 (the helper handles this), so
          // the cost always succeeds.
          state = loseLife(state, stackObject.controllerId as PlayerId, amount);
        }
        stackAny.cost_paid = true;
      }
      // `cost_paid === true` (already paid): fall
      // through to effects. `cost_paid === false`
      // (the trigger fizzled defensively above).
      if (stackAny.cost_paid === false) return state;
    }
  }
  // Lane 88 (#2614 follow-up): sacrifice-self cost gate.
  const hasSacrificeCost = (ability as { cost?: { sacrifice_self?: boolean } })
    .cost?.sacrifice_self === true;
  if (hasSacrificeCost) {
    // Defensive: if the source has already been sacrificed by another
    // effect (the cost can't be paid), the trigger fizzles. CR 602.2b.
    const sourceStillPresent =
      stackObject.sourceCardId !== null &&
      state.cards.has(stackObject.sourceCardId as CardInstanceId) &&
      state.zones.get(
        `${stackObject.controllerId as PlayerId}-battlefield`,
      )?.cardIds.includes(stackObject.sourceCardId);
    if (!sourceStillPresent) return state;
    // Track the cost_paid status; default undefined = awaiting answer.
    const costPaid = (stackObject as StackObject & { cost_paid?: boolean })
      .cost_paid;
    if (costPaid === false) {
      // Controller declined: the trigger does nothing.
      return state;
    }
    if (costPaid === undefined) {
      return {
        ...state,
        waitingChoice: createSacrificeSelfPromptWaitingChoice(
          stackObject.id,
          stackObject.controllerId as PlayerId,
          ability.text,
        ),
      };
    }
    // costPaid === true: sacrifice the source, then fall through to
    // resolve effects. The sacrifice is its own state mutation that
    // runs before the effects loop (CR 602.2b "the cost is paid
    // before the spell or ability resolves").
    if (
      stackObject.sourceCardId !== null &&
      state.cards.has(stackObject.sourceCardId as CardInstanceId)
    ) {
      const sacrificed = sacrificeCard(
        state,
        stackObject.sourceCardId,
      );
      if (sacrificed.success) state = sacrificed.state;
      else return state;
    }
  }
  // Wave 4.8 follow-up 13 lane 98 (#2614 follow-up):
  // discard-a-card cost gate (parallel to the lane 88
  // sacrifice-self substrate). When `cost.discard: {
  // amount: 1 }` is set, the engine surfaces a yes/no
  // `discard_prompt` WaitingChoice; on yes, the
  // controller discards `amount` cards; on no, the
  // trigger does nothing (CR 602.2b). v1 supports a
  // single-card discard (`amount: 1`); the multi-card
  // variant rides a follow-up lane.
  const discardCost = (ability as {
    cost?: { discard?: { amount: number } };
  }).cost?.discard;
  if (discardCost !== undefined) {
    const stackAny = stackObject as StackObject & {
      cost_paid?: boolean;
    };
    const costPaid = stackAny.cost_paid;
    if (costPaid === false) {
      // Controller declined: the trigger does nothing.
      return state;
    }
    if (costPaid === undefined) {
      return {
        ...state,
        waitingChoice: createDiscardPromptWaitingChoice(
          stackObject.id,
          stackObject.controllerId as PlayerId,
          ability.text,
          discardCost.amount,
        ),
      };
    }
    // costPaid === true: discard `amount` cards, then
    // fall through to resolve effects. The discard is
    // its own state mutation that runs before the
    // effects loop (CR 602.2b).
    const discard = discardCards(
      state,
      stackObject.controllerId as PlayerId,
      discardCost.amount,
      true, // v1 uses random discard (controller-choice selection is a follow-up lane)
    );
    if (discard.success) state = discard.state;
    else {
      // The controller's hand is empty or doesn't have
      // enough cards — defensive: the trigger fizzles
      // (CR 602.2b).
      return state;
    }
  }
  // Wave 4.8 follow-up 13 lane 106 (#2614 follow-up):
  // "you may pay [life]; if you do, [X]" alternate cost
  // (Aether Burst / Skeleton Scarab / Necropotence
  // style). Parallel to the lane 88 `sacrifice_self`
  // and lane 98 `discard` substrates. When
  // `cost.pay_life.amount: N` is set, the engine
  // surfaces a yes/no prompt (reusing the
  // `you_may_prompt` shape — a yes/no yes/no gate for
  // the cost consent); on yes, the controller loses
  // `amount` life via the existing `loseLife` helper
  // (the `state.turn.creatureDiedThisTurn` counter is
  // NOT bumped — life loss is not the same as dying);
  // on no, the trigger fizzles (CR 602.2b).
  //
  // The `additionalCosts.pay_life` arm on `CardScript`
  // (from lane 63) is spell-cast only — the
  // `cost.pay_life` arm is the lane 106 trigger-cost
  // substrate. v1 supports a single integer `amount`.
  const payLifeCost = (ability as {
    cost?: { pay_life?: { amount: number } };
  }).cost?.pay_life;
  if (payLifeCost !== undefined) {
    const stackAny = stackObject as StackObject & {
      cost_paid?: boolean;
    };
    const costPaid = stackAny.cost_paid;
    if (costPaid === false) {
      // Controller declined: the trigger does nothing.
      return state;
    }
    if (costPaid === undefined) {
      // Surface a `pay_life_prompt` yes/no consent
      // gate. The `pay_life_prompt` branch in
      // `spell-casting/choices.ts` stamps
      // `stackObject.cost_paid` (parallel to
      // `discard_prompt`); the engine consult runs
      // `loseLife` on `cost_paid === true`.
      return {
        ...state,
        waitingChoice: {
          type: "pay_life_prompt",
          playerId: stackObject.controllerId as PlayerId,
          stackObjectId: stackObject.id,
          prompt: `${ability.text} (pay ${payLifeCost.amount} life?)`,
          choices: [
            { label: "Yes", value: true, isValid: true },
            { label: "No", value: false, isValid: true },
          ],
          minChoices: 1,
          maxChoices: 1,
          presentedAt: Date.now(),
        },
      };
    }
    // costPaid === true: lose `amount` life, then fall
    // through to resolve effects. The life loss is
    // its own state mutation that runs before the
    // effects loop (CR 602.2b "the cost is paid before
    // the spell or ability resolves"). `loseLife` returns
    // `GameState` directly (not a `KeywordActionResult`).
    state = loseLife(
      state,
      stackObject.controllerId as PlayerId,
      payLifeCost.amount,
    );
  }
  // Wave 4.8 follow-up 17 lane 117 (#2614 follow-up):
  // parallel to the lane 106 `cost.pay_life` substrate.
  // "Pay N mana:" as a trigger cost — Mana Echo / Selvala
  // Heart of the Wilds style. The engine surfaces a
  // yes/no prompt (`pay_mana_prompt` waitingChoice); on
  // yes, the controller pays `amount` generic mana via
  // the existing `spendMana` helper (the standard
  // generic → colorless → colored cascade); on no, the
  // trigger fizzles (CR 602.2b).
  //
  // The check runs BEFORE the effects resolution so the
  // prompt surfaces on the first pass (before any
  // effects are applied). The `cost_paid === undefined`
  // path surfaces the prompt; `cost_paid === false`
  // fizzes; `cost_paid === true` deducts mana and
  // falls through to the effects loop.
  const payManaCost = (ability as {
    cost?: { pay_mana?: { amount: number } };
  }).cost?.pay_mana;
  if (payManaCost !== undefined) {
    const stackAny = stackObject as StackObject & {
      cost_paid?: boolean;
    };
    const costPaid = stackAny.cost_paid;
    if (costPaid === false) {
      // Controller declined: the trigger does nothing.
      return state;
    }
    if (costPaid === undefined) {
      // Surface a `pay_mana_prompt` yes/no consent
      // gate. The `pay_mana_prompt` branch in
      // `spell-casting/choices.ts` stamps
      // `stackObject.cost_paid` (parallel to
      // `pay_life_prompt`); the engine consult runs
      // `spendMana` on `cost_paid === true`.
      return {
        ...state,
        waitingChoice: {
          type: "pay_mana_prompt",
          playerId: stackObject.controllerId as PlayerId,
          stackObjectId: stackObject.id,
          prompt: `${ability.text} (pay ${payManaCost.amount} mana?)`,
          choices: [
            { label: "Yes", value: true, isValid: true },
            { label: "No", value: false, isValid: true },
          ],
          minChoices: 1,
          maxChoices: 1,
          presentedAt: Date.now(),
        },
      };
    }
    // costPaid === true: spend `amount` generic mana,
    // then fall through to resolve effects. The mana
    // deduction runs before the effects loop
    // (CR 602.2b "the cost is paid before the spell or
    // ability resolves"). If the controller has fewer
    // than `amount` mana in the pool, the trigger
    // fizzles (defensive — the player should never
    // have been able to confirm the prompt without
    // the mana, but the engine surfaces a no-op on
    // short mana as a safety net).
    const spendResult = spendMana(
      state,
      stackObject.controllerId as PlayerId,
      { generic: payManaCost.amount },
    );
    if (spendResult.success) {
      state = spendResult.state;
    } else {
      // Defensive: short mana — fizzles.
      return state;
    }
  }
  const effects = getScriptedAbilityEffects(state, stackObject);
  if (!effects) return undefined;
  return resolveScriptedEffects(state, effects, stackObject);
}
