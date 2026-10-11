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
import { returnEarthbentLands } from "./earthbend";
import { getCardColors } from "../evergreen-keywords";

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
  const printed = (after ?? "").split(/\s+/).filter(Boolean);
  // Wave 4.8 lane 52 (#2614 follow-up): union the
  // printed subtypes with the per-instance
  // `chosenTypeAdditions` stamped by
  // `refreshScriptedStatics`. This lets the chosen-type anthem
  // (lane 45) — which calls `subtypesOf(target)` — see the
  // chosen-type addition on the source itself, so the
  // Adaptive Automaton anthem path (the source matches
  // itself via `affects.subtype: "chosen"`) reads back the
  // chosenCreatureType that was just added. The deduplication
  // is order-preserving via Set's insertion order so
  // printed subtypes (the printed type line) come first.
  const additions = card.chosenTypeAdditions ?? [];
  if (additions.length === 0) return printed;
  return [...printed, ...additions.filter((t) => !printed.includes(t))];
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

/**
 * Compute the state-derived `X` contribution for a scaling anthem
 * (#2594 follow-up, lane 36, Smaug, Tempest Djinn, Blanchwood Armor).
 * Returns 0 when `X` is unset.
 */
function computeX(state: GameState, source: CardInstance, kind: string): number {
  if (kind === "treasures") {
    let n = 0;
    for (const card of battlefieldCards(state)) {
      if (card.controllerId !== source.controllerId) continue;
      // Treasure tokens are typed as a "Treasure" artifact on the
      // battlefield. The token's `cardData.type_line` is the one
      // written by the token factory; we read it verbatim.
      const typeLine = (card.cardData.type_line ?? "").toLowerCase();
      if (typeLine.includes("treasure")) n++;
    }
    return n;
  }
  if (kind === "creatures") {
    let n = 0;
    for (const card of battlefieldCards(state)) {
      if (card.controllerId !== source.controllerId) continue;
      if (isCreature(card)) n++;
    }
    return n;
  }
  if (kind === "lands") {
    let n = 0;
    for (const card of battlefieldCards(state)) {
      if (card.controllerId !== source.controllerId) continue;
      if ((card.cardData.type_line ?? "").toLowerCase().includes("land")) n++;
    }
    return n;
  }
  return 0;
}

/** True when the static on `source` applies to `target` (CR 611.3a). */
export function staticAffects(
  stat: ScriptedStatic,
  source: CardInstance,
  target: CardInstance,
): boolean {
  // Wave 4.7 phase 2 lane 50 (#2708 phase 2b): the chosen-name
  // block static is a meta-static that gates non-mana activated
  // ability activation (Sorcerous Spyglass pattern). It doesn't
  // grant P/T or keywords — instead it identifies the source as a
  // "Spyglass-like" card whose `chosenCardName` is the gate key.
  // `staticAffects` returns true iff `target.cardData.name`
  // matches the source's `chosenCardName`, with `target` allowed
  // to be any kind of permanent (not just creatures) — Sorcerous
  // Spyglass's restriction is on "sources" of activated abilities,
  // which includes lands, artifacts, and enchantments.
  if (stat.affects.chosen_name_block === true) {
    if (!source.chosenCardName) return false;
    return target.cardData.name === source.chosenCardName;
  }
  // Wave 4.8 lane 52 (#2614 follow-up): the chosen-type addition
  // static. The source adds the named creature type (or its
  // `chosenCreatureType`) to its own subtypes while on the
  // battlefield (Adaptive Automaton's "is the chosen type in
  // addition to its other types" half). v1 is self-only — the
  // static returns true iff `source === target` (the source
  // adds to itself). The Aura-style "enchanted creature is the
  // chosen type" generalization rides lane 54. When the
  // sentinel `"chosen"` is in use the source also needs a
  // resolved `chosenCreatureType`; otherwise the static is
  // inert (the player hasn't answered the enter choice yet).
  // The actual growth of `source.chosenTypeAdditions` is
  // handled by `refreshScriptedStatics` (this branch only
  // computes applicability).
  if (stat.affects.add_creature_type !== undefined) {
    if (stat.affects.addCreatureTypeToSelf !== true) return false;
    if (source.id !== target.id) return false;
    if (stat.affects.add_creature_type === "chosen") {
      return source.chosenCreatureType !== null;
    }
    return true;
  }
  if (!isCreature(target)) return false;
  const { controller, other, self, subtype, color } = stat.affects;
  if (other && source.id === target.id) return false;
  // #2594 follow-up, lane 36: `self: true` restricts the anthem to the
  // source only (Smaug, Tempest Djinn). Mutually exclusive with `other`
  // in spirit, but the engine doesn't enforce that — `self: true,
  // other: true` is contradictory; the engine just doesn't apply.
  if (self && source.id !== target.id) return false;
  const sameController = source.controllerId === target.controllerId;
  if (controller === "you" ? !sameController : sameController) return false;
  // Color filter (#2594 lane 30): a single-color anthem like Knight of
  // Grace's "White creatures you control get +1/+1" only applies to
  // creatures whose colors include the named color. Scryfall stores
  // colors as single letters ("W"..."G"); getCardColors normalises to
  // lowercase words ("white"..."green"), so we map before comparing.
  if (color) {
    const COLOR_MAP: Record<string, string> = {
      W: "white",
      U: "blue",
      B: "black",
      R: "red",
      G: "green",
    };
    // #2594 follow-up, Wave 4.7 lane 40: `"chosen"` is a sentinel
    // meaning "use the source's chosenColor instance field"
    // (Heraldic Banner's chosen-color anthem). If the source has no
    // chosenColor yet — the player hasn't answered the enter
    // choice — the anthem is inert (idempotent; the card is still
    // on the battlefield and will start buffing once the choice
    // resolves).
    if (color === "chosen") {
      if (!source.chosenColor) return false;
      const wanted = COLOR_MAP[source.chosenColor];
      const targetColors = getCardColors(target);
      if (!targetColors.includes(wanted)) return false;
    } else {
      const wanted = COLOR_MAP[color];
      const targetColors = getCardColors(target);
      if (!targetColors.includes(wanted)) return false;
    }
  }
  if (subtype) {
    // Wave 4.7 follow-up lane 45 (#2705b): `"chosen"` is a
    // sentinel meaning "use the source's chosenCreatureType
    // instance field" (Adaptive Automaton's chosen-type anthem).
    // The source must carry `enter_choice: { kind:
    // "creature_type" }` (Wave 4.7 follow-up lane 44, #2705a);
    // mirrors the lane 40 chosen-color anthem.
    if (subtype === "chosen") {
      if (!source.chosenCreatureType) return false;
      return (
        Boolean(target.animatedUntilEndOfTurn?.allCreatureTypes) ||
        subtypesOf(target).includes(source.chosenCreatureType)
      );
    }
    return (
      Boolean(target.animatedUntilEndOfTurn?.allCreatureTypes) ||
      subtypesOf(target).includes(subtype)
    );
  }
  return true;
}

/**
 * Recompute `scriptStaticPT`, `scriptStaticKeywords`, and
 * `chosenTypeAdditions` for every card. Returns the same state
 * object when nothing changed.
 */
export function refreshScriptedStatics(input: GameState): GameState {
  const state = restoreAnimatedOffBattlefield(returnEarthbentLands(input));
  const onField = battlefieldCards(state);
  const sources: { card: CardInstance; statics: ScriptedStatic[] }[] = [];
  for (const card of onField) {
    const statics = getCardScript(card.cardData.name)?.statics;
    if (statics) sources.push({ card, statics });
  }

  const pt = new Map<string, { power: number; toughness: number }>();
  const kws = new Map<string, string[]>();
  // Wave 4.8 lane 52 (#2614 follow-up): per-card subtype
  // additions stamped by `affects.add_creature_type` statics.
  // The chosen-type anthem (lane 45) reads `subtypesOf(target)`
  // which unions these into the read at the next refresh pass
  // — so Adaptive Automaton's anthem path can match the
  // source against itself via the chosen creature type.
  const typeAdditions = new Map<string, string[]>();
  for (const target of onField) {
    let power = 0;
    let toughness = 0;
    const granted = new Set<string>();
    const additions = new Set<string>();
    for (const { card, statics } of sources) {
      for (const stat of statics) {
        if (!staticAffects(stat, card, target)) continue;
        // Wave 4.8 lane 52 (#2614 follow-up): grow the
        // target's `chosenTypeAdditions` if this static
        // is a chosen-type addition and the source's
        // chosen creature type is resolved. The addition
        // is a separate write from P/T and keywords
        // because it is a type-line overlay, not a P/T
        // or keyword grant — it is read by
        // `subtypesOf(target)` so other statics (the
        // chosen-type anthem in lane 45) can match
        // against the addition at the next pass.
        if (
          stat.affects.add_creature_type !== undefined &&
          stat.affects.addCreatureTypeToSelf === true
        ) {
          const addition =
            stat.affects.add_creature_type === "chosen"
              ? card.chosenCreatureType
              : stat.affects.add_creature_type;
          if (addition) additions.add(addition);
        }
        if (stat.X) {
          // #2594 follow-up, lane 36: when `X` is set, the count
          // overrides the integer `power`/`toughness` for this
          // static. The card's text usually reads "gets +X/+X" so
          // both sides are set to the same count.
          const x = computeX(state, card, stat.X);
          power += x;
          toughness += x;
        } else {
          power += stat.power ?? 0;
          toughness += stat.toughness ?? 0;
        }
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
    if (additions.size > 0)
      typeAdditions.set(target.id, [...additions].sort());
  }

  let cards: GameState["cards"] | null = null;
  for (const [cardId, card] of state.cards) {
    const nextPT = pt.get(cardId);
    const nextKw = kws.get(cardId) ?? [];
    const nextAdds = typeAdditions.get(cardId);
    const prevKw = card.scriptStaticKeywords ?? [];
    const prevAdds = card.chosenTypeAdditions ?? [];
    const samePT =
      (card.scriptStaticPT?.power ?? 0) === (nextPT?.power ?? 0) &&
      (card.scriptStaticPT?.toughness ?? 0) === (nextPT?.toughness ?? 0);
    const sameKw =
      prevKw.length === nextKw.length &&
      prevKw.every((k, i) => k === nextKw[i]);
    // Wave 4.8 lane 52 (#2614 follow-up): chosen-type
    // additions are part of the change-detection diff so
    // the refresh pass re-stamps the card only when the
    // additions actually changed. Compare sorted arrays
    // element-by-element.
    const sameAdds =
      (nextAdds ? nextAdds.length : 0) === prevAdds.length &&
      (nextAdds ?? []).every((t, i) => t === prevAdds[i]);
    if (samePT && sameKw && sameAdds) continue;
    cards ??= new Map(state.cards);
    const updated = { ...card };
    if (nextPT) updated.scriptStaticPT = nextPT;
    else delete updated.scriptStaticPT;
    if (nextKw.length > 0) updated.scriptStaticKeywords = nextKw;
    else delete updated.scriptStaticKeywords;
    // Wave 4.8 lane 52: clear `chosenTypeAdditions` when the
    // source has left the battlefield (no static currently
    // grants the addition — the source card is no longer
    // in `sources`). The local `subtypesOf` helper unions
    // these with the printed type line; absent means the
    // addition drops, which matches the natural
    // "battlefield-zone-only" semantics.
    if (nextAdds && nextAdds.length > 0)
      updated.chosenTypeAdditions = nextAdds;
    else delete updated.chosenTypeAdditions;
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
