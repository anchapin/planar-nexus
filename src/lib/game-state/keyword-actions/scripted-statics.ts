/**
 * Static abilities from card scripts (issue #2496): "Creatures you control get
 * +1/+1", "Other Dinosaurs you control get +1/+1", "Creatures you control have
 * haste". Continuous effects from static abilities (CR 611.3) apply in layer 6
 * (keywords) and layer 7c (P/T). Like the tribal and Aura statics, the summed
 * result is kept on the card and refreshed with the state-based-action pass,
 * because `getEffectivePower` and `hasKeyword` only see the card.
 */
import type { CardInstance, GameState } from "../types";
import { getCardScript } from "../card-scripts/registry";
import type { RuleStatic, ScriptedStatic } from "../card-scripts/schema";
import { restoreAnimatedOffBattlefield } from "../pt-until-end-of-turn";

function battlefieldCards(state: GameState): CardInstance[] {
  const out: CardInstance[] = [];
  for (const [key, zone] of state.zones) {
    if (!key.endsWith("-battlefield")) continue;
    for (const id of zone.cardIds) {
      const card = state.cards.get(id);
      if (card) out.push(card);
    }
  }
  return out;
}

function isCreature(card: CardInstance): boolean {
  return /\bCreature\b/.test(card.cardData.type_line ?? "");
}

function subtypesOf(card: CardInstance): string[] {
  const after = (card.cardData.type_line ?? "").split(/\s+[\u2014-]\s+/)[1];
  return (after ?? "").split(/\s+/).filter(Boolean);
}

const CARD_TYPES = [
  "artifact",
  "battle",
  "creature",
  "enchantment",
  "instant",
  "kindred",
  "land",
  "planeswalker",
  "sorcery",
];

/**
 * Number of card types among cards in exile linked to `source` (#2614
 * Keen-Eyed Curator). Links from an earlier object of the same card
 * (another battlefield timestamp) don't count (CR 400.7).
 */
export function exiledCardTypes(
  state: GameState,
  source: CardInstance,
): number {
  const types = new Set<string>();
  for (const [key, zone] of state.zones) {
    if (!key.endsWith("-exile")) continue;
    for (const id of zone.cardIds) {
      const card = state.cards.get(id);
      const link = card?.exiledWith;
      if (
        !card ||
        !link ||
        link.sourceId !== source.id ||
        link.timestamp !== source.enteredBattlefieldTimestamp
      ) {
        continue;
      }
      const front = (card.cardData.type_line ?? "")
        .split("//")[0]
        .split(/\s+[\u2014-]\s+/)[0]
        .toLowerCase();
      for (const t of CARD_TYPES) if (front.includes(t)) types.add(t);
    }
  }
  return types.size;
}

/** True when the static on `source` applies to `target` (CR 611.3a). */
export function staticAffects(
  stat: ScriptedStatic,
  source: CardInstance,
  target: CardInstance,
): boolean {
  if (!isCreature(target)) return false;
  const { controller, other, subtype } = stat.affects;
  if (other && source.id === target.id) return false;
  const sameController = source.controllerId === target.controllerId;
  if (controller === "you" ? !sameController : sameController) return false;
  return (
    !subtype ||
    Boolean(target.animatedUntilEndOfTurn?.allCreatureTypes) ||
    subtypesOf(target).includes(subtype)
  );
}

/**
 * Recompute `scriptStaticPT` and `scriptStaticKeywords` for every card.
 * Returns the same state object when nothing changed.
 */
export function refreshScriptedStatics(input: GameState): GameState {
  const state = restoreAnimatedOffBattlefield(input);
  const onField = battlefieldCards(state);
  const sources: { card: CardInstance; statics: ScriptedStatic[] }[] = [];
  for (const card of onField) {
    const statics = getCardScript(card.cardData.name)?.statics;
    if (statics) sources.push({ card, statics });
  }

  const pt = new Map<string, { power: number; toughness: number }>();
  const kws = new Map<string, string[]>();
  for (const target of onField) {
    let power = 0;
    let toughness = 0;
    const granted = new Set<string>();
    for (const { card, statics } of sources) {
      for (const stat of statics) {
        if (!staticAffects(stat, card, target)) continue;
        power += stat.power ?? 0;
        toughness += stat.toughness ?? 0;
        for (const k of stat.keywords ?? []) granted.add(k);
      }
    }
    // #2614 Keen-Eyed Curator: a self bonus from card types among cards
    // exiled with this permanent (CR 607.2a).
    const bonus = getCardScript(target.cardData.name)?.exiled_types_bonus;
    if (bonus && exiledCardTypes(state, target) >= bonus.min_types) {
      power += bonus.power;
      toughness += bonus.toughness;
      for (const k of bonus.keywords ?? []) granted.add(k);
    }
    if (power || toughness) pt.set(target.id, { power, toughness });
    if (granted.size > 0) kws.set(target.id, [...granted].sort());
  }

  let cards: GameState["cards"] | null = null;
  for (const [cardId, card] of state.cards) {
    const nextPT = pt.get(cardId);
    const nextKw = kws.get(cardId) ?? [];
    const prevKw = card.scriptStaticKeywords ?? [];
    const samePT =
      (card.scriptStaticPT?.power ?? 0) === (nextPT?.power ?? 0) &&
      (card.scriptStaticPT?.toughness ?? 0) === (nextPT?.toughness ?? 0);
    const sameKw =
      prevKw.length === nextKw.length &&
      prevKw.every((k, i) => k === nextKw[i]);
    if (samePT && sameKw) continue;
    cards ??= new Map(state.cards);
    const updated = { ...card };
    if (nextPT) updated.scriptStaticPT = nextPT;
    else delete updated.scriptStaticPT;
    if (nextKw.length > 0) updated.scriptStaticKeywords = nextKw;
    else delete updated.scriptStaticKeywords;
    cards.set(cardId, updated);
  }
  return cards ? { ...state, cards } : state;
}

/**
 * True while a permanent with the scripted rule-changing static is on the
 * battlefield (#2614): "Players can't gain life" (CR 119.7), "Damage can't be
 * prevented" (CR 615.12).
 */
export function scriptRuleActive(state: GameState, rule: RuleStatic): boolean {
  for (const card of battlefieldCards(state)) {
    const rules = getCardScript(card.cardData.name)?.rules;
    if (rules?.some((r) => r.rule === rule)) return true;
  }
  return false;
}
