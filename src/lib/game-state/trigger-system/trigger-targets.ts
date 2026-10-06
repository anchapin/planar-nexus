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
import { getCardScript } from "../card-scripts/registry";
import {
  isPermanentScript,
  isTargetedEffect,
  modalEffects,
  modeChoiceError,
  scriptedSpellEffects,
} from "../card-scripts/script-guards";
import type { CardEffect, ScriptedModes } from "../card-scripts/schema";
import {
  matchesRemovalFilter,
  type RemovalFilter,
} from "../card-scripts/target-filters";

export type TriggerTargetKind =
  "creature" | "permanent" | "player" | "opponent" | "any";

export interface TriggerTargetSpec {
  kind: TriggerTargetKind;
  /** Whose creatures qualify (creature / any targets only). */
  controller: "you" | "opponent" | "any";
  /** "up to one target ..." — choosing nothing is legal. */
  optional: boolean;
  /** "another target creature" — the source itself is excluded. */
  excludeSource: boolean;
  /** Scripted Destroy/Exile: which permanents qualify (#2528). */
  filter?: RemovalFilter;
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

function battlefieldPermanents(state: GameState): CardInstance[] {
  const out: CardInstance[] = [];
  for (const playerId of state.players.keys()) {
    const zone = state.zones.get(`${playerId}-battlefield`);
    for (const id of zone?.cardIds ?? []) {
      const card = state.cards.get(id);
      if (card) out.push(card);
    }
  }
  return out;
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
  return legalTargetsForSpec(
    state,
    parseTriggerTargetSpec(text),
    controllerId,
    sourceCardId,
  );
}

/** Legal target ids (cards and players) for a parsed target requirement. */
function legalTargetsForSpec(
  state: GameState,
  spec: TriggerTargetSpec | null,
  controllerId: PlayerId,
  sourceCardId: CardInstanceId | null,
): string[] {
  if (!spec) return [];
  const source = sourceCardId ? state.cards.get(sourceCardId) : undefined;
  const ids: string[] = [];

  if (
    spec.kind === "creature" ||
    spec.kind === "permanent" ||
    spec.kind === "any"
  ) {
    const candidates =
      spec.kind === "permanent"
        ? battlefieldPermanents(state)
        : battlefieldCreatures(state);
    for (const card of candidates) {
      if (spec.filter && !matchesRemovalFilter(card, spec.filter)) continue;
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

const sameText = (a: string, b: string) =>
  a.trim().toLowerCase() === b.trim().toLowerCase();

/**
 * The modes of a scripted modal triggered or activated ability on the stack
 * (#2525), or undefined when the ability isn't modal or isn't scripted.
 */
function scriptedAbilityModes(
  state: GameState,
  obj: StackObject,
): { name: string; modes: ScriptedModes } | undefined {
  if (!(obj.triggered || obj.activated) || !obj.sourceCardId) return undefined;
  const source = state.cards.get(obj.sourceCardId);
  const script = getCardScript(source?.cardData.name);
  if (!script || !isPermanentScript(script)) return undefined;
  const abilities: readonly { text: string; modes?: ScriptedModes }[] =
    obj.triggered ? (script.triggers ?? []) : (script.activated ?? []);
  const modes = abilities.find((a) => sameText(a.text, obj.text))?.modes;
  return modes ? { name: script.name, modes } : undefined;
}

/**
 * Target requirement of a list of scripted effects: the first targeted
 * effect decides it. null when none targets, or it targets something this
 * module doesn't model (a spell on the stack, for example).
 */
function effectsTargetSpec(
  effects: readonly CardEffect[],
): TriggerTargetSpec | null {
  for (const effect of effects) {
    if (!isTargetedEffect(effect)) continue;
    const base = {
      controller: "any" as const,
      optional: false,
      excludeSource: false,
    };
    if (effect.op === "DealDamage" && effect.target !== "each_opponent") {
      return { ...base, kind: effect.target };
    }
    if (effect.op === "Destroy" || effect.op === "Exile") {
      const filter: RemovalFilter = {
        target: effect.target,
        min_power: effect.min_power,
        max_power: effect.max_power,
      };
      const kind = effect.target === "creature" ? "creature" : "permanent";
      return { ...base, kind, filter };
    }
    if (effect.op === "Pump" || effect.op === "PutCounters") {
      return { ...base, kind: "creature" };
    }
    if (
      effect.op === "Draw" ||
      effect.op === "GainLife" ||
      effect.op === "LoseLife"
    ) {
      return { ...base, kind: "player" };
    }
    return null;
  }
  return null;
}

/**
 * Target requirement of a triggered or activated ability on the stack. A
 * scripted modal ability targets what its chosen modes target; anything else
 * is read from its text.
 */
function abilityTargetSpec(
  state: GameState,
  obj: StackObject,
): TriggerTargetSpec | null {
  const modal = scriptedAbilityModes(state, obj);
  if (modal)
    return effectsTargetSpec(modalEffects(modal.modes, obj.chosenModes));
  return parseTriggerTargetSpec(obj.text);
}

/** The text a stack ability's target choice reads: its chosen modes when modal. */
function abilityTargetText(state: GameState, obj: StackObject): string {
  return scriptedAbilityModes(state, obj) && obj.chosenModes.length > 0
    ? obj.chosenModes.join(" ")
    : obj.text;
}

/**
 * The modes to choose from for a modal triggered or activated ability on the
 * stack, or null when it isn't modal.
 */
export function getAbilityModes(
  state: GameState,
  obj: StackObject,
): { choose: number; options: string[] } | null {
  const modal = scriptedAbilityModes(state, obj);
  return modal
    ? {
        choose: modal.modes.choose,
        options: modal.modes.options.map((o) => o.text),
      }
    : null;
}

/**
 * True when a modal ability on the stack still needs its modes chosen. Modes
 * come first: they decide what it targets (CR 603.3c, 700.2a).
 */
export function abilityNeedsModes(state: GameState, obj: StackObject): boolean {
  return (
    obj.chosenModes.length === 0 && Boolean(scriptedAbilityModes(state, obj))
  );
}

/** Set the modes of a modal triggered or activated ability on the stack. */
export function chooseAbilityModes(
  state: GameState,
  stackObjectId: string,
  modes: readonly string[],
): ChooseTriggerTargetsResult {
  const obj = findTrigger(state, stackObjectId);
  const modal = obj && scriptedAbilityModes(state, obj);
  if (!obj || !modal) {
    return { success: false, state, error: "No modal ability to choose for" };
  }
  const error = modeChoiceError(modal.name, modal.modes, modes);
  if (error) return { success: false, state, error };
  return {
    success: true,
    state: {
      ...state,
      stack: state.stack.map((o) =>
        o.id === stackObjectId ? { ...o, chosenModes: [...modes] } : o,
      ),
    },
  };
}

/**
 * The AI's default modes: the ones it can carry out, in printed order,
 * preferring a mode that removes or damages an opposing creature, then any
 * mode that needs no target, then a mode with a legal target.
 */
function pickModes(
  state: GameState,
  obj: StackObject,
  modes: ScriptedModes,
): string[] {
  const me = obj.controllerId;
  const scored = modes.options.map((option, index) => {
    const spec = effectsTargetSpec(option.effects);
    const targeted = option.effects.some(isTargetedEffect);
    if (!targeted) return { option, index, score: 2 };
    const legal = legalTargetsForSpec(state, spec, me, obj.sourceCardId);
    if (legal.length === 0) return { option, index, score: -1 };
    const hostile = option.effects.some(
      (e) => e.op === "Destroy" || e.op === "Exile" || e.op === "DealDamage",
    );
    const opposing = legal.some((id) => {
      const card = state.cards.get(id as CardInstanceId);
      return card ? card.controllerId !== me : id !== me;
    });
    return { option, index, score: hostile && opposing ? 3 : 1 };
  });
  return scored
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, modes.choose)
    .sort((a, b) => a.index - b.index)
    .map((s) => s.option.text);
}

/**
 * Choose default modes for every modal ability on the stack that still needs
 * them, for `controllerId` (or every controller when omitted). Used by the
 * AI; a human player chooses with `chooseAbilityModes`.
 */
export function autoChooseAbilityModes(
  state: GameState,
  controllerId?: PlayerId,
): GameState {
  let current = state;
  for (const obj of state.stack) {
    if (controllerId && obj.controllerId !== controllerId) continue;
    const modal = scriptedAbilityModes(current, obj);
    if (!modal || obj.chosenModes.length > 0) continue;
    const result = chooseAbilityModes(
      current,
      obj.id,
      pickModes(current, obj, modal.modes),
    );
    if (result.success) current = result.state;
  }
  return current;
}

/** Legal target ids (cards and players) for a triggered ability on the stack. */
export function getLegalTriggerTargets(
  state: GameState,
  stackObject: StackObject,
): string[] {
  return legalTargetsForSpec(
    state,
    abilityTargetSpec(state, stackObject),
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
  chosenModes?: readonly string[],
): TriggerTargetSpec | null {
  const card = state.cards.get(cardId);
  if (!card) return null;
  const scripted = scriptedSpellTargetSpec(card.cardData.name, chosenModes);
  if (scripted !== undefined) return scripted;
  return parseTriggerTargetSpec(card.cardData.oracle_text ?? "");
}

/**
 * Target requirement from a card's script (#2489): the first targeted effect
 * decides it. Returns undefined when the card has no script, so callers fall
 * back to oracle text, and null when the script targets nothing this module
 * models (a spell on the stack, for example). For a modal spell the chosen
 * modes decide it; with no modes given, every mode is considered.
 */
export function scriptedSpellTargetSpec(
  cardName: string | undefined,
  chosenModes?: readonly string[],
): TriggerTargetSpec | null | undefined {
  const script = getCardScript(cardName);
  if (!script) return undefined;
  return effectsTargetSpec(scriptedSpellEffects(script, chosenModes));
}

/** Legal target ids (cards and players) for casting a spell. */
export function getLegalSpellTargets(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  chosenModes?: readonly string[],
): string[] {
  if (!state.cards.has(cardId)) return [];
  return legalTargetsForSpec(
    state,
    getSpellTargetSpec(state, cardId, chosenModes),
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
 * targets chosen. Pass `state` so a scripted modal ability is judged by its
 * chosen modes (and waits until they are chosen); without it, by its text.
 */
export function triggerNeedsTargets(
  stackObject: StackObject,
  state?: GameState,
): boolean {
  if (
    !(stackObject.triggered || stackObject.activated) ||
    stackObject.targets.length > 0 ||
    stackObject.targetsChosen
  )
    return false;
  if (state && scriptedAbilityModes(state, stackObject)) {
    return (
      stackObject.chosenModes.length > 0 &&
      abilityTargetSpec(state, stackObject) !== null
    );
  }
  return parseTriggerTargetSpec(stackObject.text) !== null;
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
  const spec = abilityTargetSpec(state, obj);
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
  const spec = abilityTargetSpec(state, obj)!;
  const legal = getLegalTriggerTargets(state, obj);
  if (legal.length === 0) return null;
  const me = obj.controllerId;
  const text = stripReminder(abilityTargetText(state, obj)).toLowerCase();
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
  let current = autoChooseAbilityModes(state, controllerId);
  for (const obj of current.stack) {
    if (controllerId && obj.controllerId !== controllerId) continue;
    if (!triggerNeedsTargets(obj, current)) continue;
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

/** What is currently choosing targets on the game screen. */
export interface PendingTargetChoice {
  /** A triggered or activated ability on the stack waiting for targets. */
  stackObjectId?: string;
  /** A spell being cast, or the source of an activated ability. */
  cardId?: string;
  /** With `cardId`, the activated ability choosing targets. */
  abilityIndex?: number;
}

/**
 * Legal target ids (cards and players) for whatever is choosing targets, so
 * the board can highlight them. Returns [] when nothing targets.
 */
export function getLegalTargetIdsForChoice(
  state: GameState,
  playerId: PlayerId,
  choice: PendingTargetChoice,
): string[] {
  if (choice.stackObjectId) {
    const obj = state.stack.find((o) => o.id === choice.stackObjectId);
    return obj ? getLegalTriggerTargets(state, obj) : [];
  }
  if (!choice.cardId) return [];
  const cardId = choice.cardId as CardInstanceId;
  if (choice.abilityIndex !== undefined) {
    return getLegalActivatedAbilityTargets(
      state,
      playerId,
      cardId,
      choice.abilityIndex,
    );
  }
  return getLegalSpellTargets(state, playerId, cardId);
}
