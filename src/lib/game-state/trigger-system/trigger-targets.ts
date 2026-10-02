/**
 * Choosing targets for triggered abilities (CR 603.3d; issue #2300).
 *
 * A triggered ability's targets are chosen as it is put on the stack. The
 * trigger system puts abilities on the stack with no targets, so a targeted
 * trigger (an ETB fight, "deals 2 damage to any target") did nothing when it
 * resolved. This module reads the first target requirement from the
 * ability's text, lists the legal choices, lets a player set them, and gives
 * the AI a default pick.
 */
import type {
  GameState,
  PlayerId,
  CardInstance,
  CardInstanceId,
  StackObject,
  Target,
} from "../types";
import { isCreature, getPower, getToughness } from "../card-instance";
import { canTargetCard } from "../targeting-validation";
import { getActivatedAbilities } from "../abilities/parse";

export type TriggerTargetKind = "creature" | "player" | "opponent" | "any";

export interface TriggerTargetSpec {
  kind: TriggerTargetKind;
  /** Whose creatures qualify (creature / any targets only). */
  controller: "you" | "opponent" | "any";
  /** "up to one target ..." — choosing nothing is legal. */
  optional: boolean;
  /** "another target creature" — the source itself is excluded. */
  excludeSource: boolean;
}

export interface ChooseTriggerTargetsResult {
  success: boolean;
  state: GameState;
  error?: string;
}

function stripReminder(text: string): string {
  return text.replace(/\([^)]*\)/g, " ");
}

/** First target requirement in a triggered ability's text, or null. */
export function parseTriggerTargetSpec(text: string): TriggerTargetSpec | null {
  const lower = stripReminder(text).toLowerCase();
  if (/\bany target\b/.test(lower)) {
    return {
      kind: "any",
      controller: "any",
      optional: /\bup to one\b/.test(lower),
      excludeSource: false,
    };
  }
  const m =
    /\b(up to one )?(another )?target (creature|player|opponent)( an opponent controls| you don't control| you control)?\b/.exec(
      lower,
    );
  if (!m) return null;
  const owner = m[4]?.trim();
  return {
    kind: m[3] as TriggerTargetKind,
    controller:
      owner === "you control"
        ? "you"
        : owner === "an opponent controls" || owner === "you don't control"
          ? "opponent"
          : "any",
    optional: Boolean(m[1]),
    excludeSource: Boolean(m[2]),
  };
}

function findTrigger(
  state: GameState,
  stackObjectId: string,
): StackObject | undefined {
  return state.stack.find(
    (o) => o.id === stackObjectId && (o.triggered || o.activated),
  );
}

function battlefieldCreatures(state: GameState): CardInstance[] {
  const out: CardInstance[] = [];
  for (const playerId of state.players.keys()) {
    const zone = state.zones.get(`${playerId}-battlefield`);
    for (const id of zone?.cardIds ?? []) {
      const card = state.cards.get(id);
      if (card && isCreature(card)) out.push(card);
    }
  }
  return out;
}

/** Legal target ids (cards and players) for a target requirement in `text`. */
function legalTargetsFor(
  state: GameState,
  text: string,
  controllerId: PlayerId,
  sourceCardId: CardInstanceId | null,
): string[] {
  const spec = parseTriggerTargetSpec(text);
  if (!spec) return [];
  const source = sourceCardId ? state.cards.get(sourceCardId) : undefined;
  const ids: string[] = [];

  if (spec.kind === "creature" || spec.kind === "any") {
    for (const card of battlefieldCreatures(state)) {
      if (spec.controller === "you" && card.controllerId !== controllerId)
        continue;
      if (spec.controller === "opponent" && card.controllerId === controllerId)
        continue;
      if (spec.excludeSource && card.id === sourceCardId) continue;
      if (source && !canTargetCard(card, source, controllerId).valid) continue;
      ids.push(card.id);
    }
  }
  if (
    spec.kind === "player" ||
    spec.kind === "opponent" ||
    spec.kind === "any"
  ) {
    for (const playerId of state.players.keys()) {
      if (spec.kind === "opponent" && playerId === controllerId) continue;
      ids.push(playerId);
    }
  }
  return ids;
}

/** Legal target ids (cards and players) for a triggered ability on the stack. */
export function getLegalTriggerTargets(
  state: GameState,
  stackObject: StackObject,
): string[] {
  return legalTargetsFor(
    state,
    stackObject.text,
    stackObject.controllerId,
    stackObject.sourceCardId,
  );
}

/**
 * Target requirement of a spell in hand, from its oracle text, or null when
 * it doesn't target (or targets something this module doesn't model yet).
 */
export function getSpellTargetSpec(
  state: GameState,
  cardId: CardInstanceId,
): TriggerTargetSpec | null {
  const card = state.cards.get(cardId);
  return card ? parseTriggerTargetSpec(card.cardData.oracle_text ?? "") : null;
}

/** Legal target ids (cards and players) for casting a spell. */
export function getLegalSpellTargets(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
): string[] {
  const card = state.cards.get(cardId);
  if (!card) return [];
  return legalTargetsFor(
    state,
    card.cardData.oracle_text ?? "",
    playerId,
    cardId,
  );
}

/**
 * Target requirement of a permanent's activated ability (by index into
 * `getActivatedAbilities`), or null when it doesn't target.
 */
export function getActivatedAbilityTargetSpec(
  state: GameState,
  cardId: CardInstanceId,
  abilityIndex: number,
): TriggerTargetSpec | null {
  const card = state.cards.get(cardId);
  if (!card) return null;
  const ability = getActivatedAbilities(card.cardData)[abilityIndex];
  return ability ? parseTriggerTargetSpec(ability.effect ?? "") : null;
}

/** Legal target ids (cards and players) for activating an ability. */
export function getLegalActivatedAbilityTargets(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  abilityIndex: number,
): string[] {
  const card = state.cards.get(cardId);
  if (!card) return [];
  const ability = getActivatedAbilities(card.cardData)[abilityIndex];
  if (!ability) return [];
  return legalTargetsFor(state, ability.effect ?? "", playerId, cardId);
}

/**
 * True when a triggered or activated ability on the stack still needs its
 * targets chosen.
 */
export function triggerNeedsTargets(stackObject: StackObject): boolean {
  return (
    Boolean(stackObject.triggered || stackObject.activated) &&
    stackObject.targets.length === 0 &&
    !stackObject.targetsChosen &&
    parseTriggerTargetSpec(stackObject.text) !== null
  );
}

/**
 * Set the targets of a triggered ability on the stack. Every id must be
 * legal; an empty choice is only legal for "up to one" abilities. Only one
 * target is supported per ability.
 */
export function chooseTriggerTargets(
  state: GameState,
  stackObjectId: string,
  targetIds: string[],
): ChooseTriggerTargetsResult {
  const obj = findTrigger(state, stackObjectId);
  if (!obj) {
    return {
      success: false,
      state,
      error: "Triggered ability not found on the stack",
    };
  }
  const spec = parseTriggerTargetSpec(obj.text);
  if (!spec) {
    return { success: false, state, error: "This ability has no targets" };
  }
  if (targetIds.length > 1) {
    return { success: false, state, error: "This ability takes one target" };
  }
  if (targetIds.length === 0 && !spec.optional) {
    return { success: false, state, error: "A target must be chosen" };
  }
  const legal = new Set(getLegalTriggerTargets(state, obj));
  const illegal = targetIds.find((id) => !legal.has(id));
  if (illegal) {
    return { success: false, state, error: `Illegal target: ${illegal}` };
  }
  const targets: Target[] = targetIds.map((id) => ({
    type: state.players.has(id as PlayerId) ? "player" : "card",
    targetId: id,
    isValid: true,
  }));
  return {
    success: true,
    state: {
      ...state,
      stack: state.stack.map((o) =>
        o.id === stackObjectId ? { ...o, targets, targetsChosen: true } : o,
      ),
    },
  };
}

const HOSTILE =
  /\bfights?\b|\bdeals? (?:\d+|x) damage\b|\bdestroy\b|\bexile\b|\bloses? \d+ life\b|-\d+\/-\d+|\btap target\b|\bdiscards?\b/;

function damageAmount(text: string): number | null {
  const m = /\bdeals? (\d+) damage\b/.exec(text);
  return m ? Number(m[1]) : null;
}

function remainingToughness(card: CardInstance): number {
  return getToughness(card) - (card.damage ?? 0);
}

/** The AI's default target for one triggered ability (null = choose none). */
function pickTarget(state: GameState, obj: StackObject): string | null {
  const spec = parseTriggerTargetSpec(obj.text)!;
  const legal = getLegalTriggerTargets(state, obj);
  if (legal.length === 0) return null;
  const me = obj.controllerId;
  const text = stripReminder(obj.text).toLowerCase();
  const hostile = HOSTILE.test(text);
  const creatures = legal
    .map((id) => state.cards.get(id as CardInstanceId))
    .filter((c): c is CardInstance => Boolean(c));
  const players = legal.filter((id) => state.players.has(id as PlayerId));
  const byPowerDesc = (a: CardInstance, b: CardInstance) =>
    getPower(b) - getPower(a) || remainingToughness(a) - remainingToughness(b);

  if (!hostile) {
    const mine = creatures
      .filter((c) => c.controllerId === me)
      .sort(byPowerDesc);
    if (mine[0]) return mine[0].id;
    if (players.includes(me)) return me;
    return spec.optional ? null : legal[0];
  }

  const theirs = creatures.filter((c) => c.controllerId !== me);
  const source = obj.sourceCardId
    ? state.cards.get(obj.sourceCardId)
    : undefined;
  const power = /\bfights?\b/.test(text)
    ? source
      ? getPower(source)
      : 0
    : damageAmount(text);

  if (power !== null) {
    const killable = theirs
      .filter((c) => remainingToughness(c) <= power)
      .sort(byPowerDesc);
    if (killable[0]) return killable[0].id;
    const opponent = players.find((p) => p !== me);
    if (opponent && !/\bfights?\b/.test(text)) return opponent;
    if (spec.optional) return null;
  }
  const best = [...theirs].sort(byPowerDesc)[0];
  if (best) return best.id;
  const opponent = players.find((p) => p !== me);
  if (opponent) return opponent;
  if (spec.optional) return null;
  return legal[0];
}

/**
 * Choose default targets for every triggered ability on the stack that still
 * needs them, for `controllerId` (or every controller when omitted). Used by
 * the AI; a human player chooses with `chooseTriggerTargets`.
 */
export function autoChooseTriggerTargets(
  state: GameState,
  controllerId?: PlayerId,
): GameState {
  let current = state;
  for (const obj of state.stack) {
    if (controllerId && obj.controllerId !== controllerId) continue;
    if (!triggerNeedsTargets(obj)) continue;
    const pick = pickTarget(current, obj);
    const result = chooseTriggerTargets(current, obj.id, pick ? [pick] : []);
    if (result.success) {
      current = result.state;
    } else {
      // Mandatory target with nothing legal: the ability is removed from the
      // stack when it would resolve (CR 603.3d); mark it chosen so it isn't
      // retried and resolves as a no-op.
      current = {
        ...current,
        stack: current.stack.map((o) =>
          o.id === obj.id ? { ...o, targetsChosen: true } : o,
        ),
      };
    }
  }
  return current;
}
