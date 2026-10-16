/**
 * Static abilities from card scripts (issue #2496): "Creatures you control get
 * +1/+1", "Other Dinosaurs you control get +1/+1", "Creatures you control have
 * haste". Continuous effects from static abilities (CR 611.3) apply in layer 6
 * (keywords) and layer 7c (P/T). Like the tribal and Aura statics, the summed
 * result is kept on the card and refreshed with the state-based-action pass,
 * because `getEffectivePower` and `hasKeyword` only see the card.
 */
import type { CardInstance, CardInstanceId, GameState, PlayerId } from "../types";
import { getCardScript, getCardDataByName } from "../card-scripts/registry";
import type {
  RuleStatic,
  ScriptedReplacementEffect,
  ScriptedStatic,
} from "../card-scripts/schema";
import type { ScryfallCard } from "../types/card-data";
import {
  restoreAnimatedOffBattlefield,
  restorePermanentTypeOverlay,
  restorePermanentCopyOffBattlefield,
} from "../pt-until-end-of-turn";
import { returnEarthbentLands } from "./earthbend";
import { getCardColors } from "../evergreen-keywords";
import {
  buildStaticCopyChainSnapshot,
  clearPermanentCopyOf,
  clearPermanentCopyPrintedCardData,
  printedCardDataOf,
  setPermanentCopyOf,
  snapshotPermanentCopyPrintedCardData,
} from "./copy-chain";

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

/**
 * Wave 4.8 follow-up 8 lane 75c (#2614 follow-up):
 * rebuild a card's `type_line` to add a list of
 * subtypes on top of the printed subtype list. Used
 * by the copy-with-exception overlay to materialize
 * Phyrexian Metamorph's "it's a [named card] in
 * addition to its other types" pattern: the lane 75
 * / 75b overlay stamps the target's printed
 * `type_line`, then the exception appends the
 * listed subtypes (e.g. `"Creature — Shapeshifter"`
 * + `["Phyrexian"]` → `"Creature — Shapeshifter
 * Phyrexian"`).
 *
 * The function expects `Scryfall`-shaped `type_line`
 * strings: `<type portion> \u2014 <subtype portion>`
 * (the `\u2014` is the em-dash separator). The
 * function splits on the FIRST em-dash (matching
 * `subtypesOf`'s split), trims surrounding
 * whitespace, dedupes (case-sensitive, exact) against
 * the printed subtype list, and re-joins.
 *
 * Edge cases:
 * - Empty / missing `type_line` → the function
 *   returns an em-dash-separated `<types> —
 *   <subtypes>` string with empty `<types>` (a
 *   guard so we don't write `undefined` back).
 * - No em-dash in the input → treated as a
 *   type-only line; the subtypes follow a synthetic
 *   em-dash.
 * - All listed subtypes already on the type line →
 *   the function returns the input unchanged
 *   (idempotent — a no-op overlay is also a valid
 *   overlay).
 */
function rebuildTypeLineWithAddedSubtypes(
  typeLine: string | undefined,
  addedSubtypes: readonly string[],
): string {
  if (addedSubtypes.length === 0) return typeLine ?? "";
  const input = typeLine ?? "";
  // Split on the FIRST em-dash (U+2014), matching
  // `subtypesOf`'s split.
  const dashIdx = input.indexOf("\u2014");
  const typesPortion =
    dashIdx >= 0 ? input.slice(0, dashIdx).trim() : input.trim();
  let subtypesPortion = "";
  if (dashIdx >= 0) {
    subtypesPortion = input
      .slice(dashIdx + 1)
      .trim();
  }
  const printedSubtypes = subtypesPortion
    .split(/\s+/)
    .filter(Boolean);
  // Dedupe added subtypes against printed
  // (case-sensitive exact). Order-preserving.
  const merged = [
    ...printedSubtypes,
    ...addedSubtypes.filter((t) => !printedSubtypes.includes(t)),
  ];
  return `${typesPortion} \u2014 ${merged.join(" ")}`.trim();
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

/**
 * Wave 4.8 follow-up 14 lane 51 (#2614 follow-up): true
 * when the source's `cardScript` carries a
 * `becomes_chosen_creature_type: true` static AND the
 * source's `chosenCreatureType` is resolved (a non-null
 * value). Drives the permanent type-line overlay
 * write-phase: when true, the refresh pass rebuilds the
 * source's `cardData.type_line` to include the chosen
 * creature type as a permanent subtype. The check is
 * deliberately based on the SOURCE's state (chosen
 * creature type resolved) rather than on
 * `staticAffects`'s output, because the overlay write
 * happens on the source itself rather than on a target.
 */
function sourceHasBecomesChosenCreatureType(
  card: CardInstance,
  sources: { card: CardInstance; statics: ScriptedStatic[] }[],
): boolean {
  for (const { card: sourceCard, statics } of sources) {
    if (sourceCard.id !== card.id) continue;
    for (const st of statics) {
      if (st.affects?.becomes_chosen_creature_type === true) {
        return sourceCard.chosenCreatureType !== null;
      }
    }
  }
  return false;
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

/**
 * Wave 4.8 follow-up 23 lane 32 (#2614 follow-up): the
 * state-derived count for an anthem's `per` arm — the
 * Warrior Knights / adaptive anthem family. The `per`
 * enum parallels the lane 36 `X` enum with one lane-32
 * addition: `other_creatures` excludes the source itself
 * ("OTHER creatures you control" semantics — the source
 * doesn't count its own presence toward the scaling
 * anthem). Returns 0 for any unknown / unspecified `per`.
 *
 * Wave 4.8 follow-up 24 lane 32 piece 2/N (#2614
 * follow-up): the optional `perSubtype` filter. When
 * the field is set, the count iteration restricts to
 * permanents whose `cardData.type_line` includes the
 * given subtype as a case-insensitive substring
 * (matching how `computeX` looks up "Treasure" /
 * "Creature" / "Land"). Sample: `perSubtype:
 * "Warrior"` filters to cards whose type line includes
 * "Warrior". When unset, the count is unfiltered (the
 * v1 default). The filter applies to every `per`
 * branch (a "Warrior" filtered count over
 * `other_creatures` counts other Warriors among the
 * source's OTHER creatures; a "Treasure" filter over
 * `treasures` filters a `treasure`-typed card to
 * only those whose type line ALSO includes the
 * chosen subtype — usually a no-op, but the v1
 * shape is parallel across `per` values).
 *
 * Wave 4.8 follow-up 25 lane 32 piece 2/N (#2614
 * follow-up): the optional `andPer` secondary
 * AND-source. When set, the count is
 * `count(per) + count(andPer.per)` — a card granting
 * "+1/+1 for each creature AND each artifact you
 * control" reads as the sum of both source counts.
 * CR 613.4c-style multi-source scaling. The
 * `andPer` arm has the same `per` enum +
 * `perSubtype` filter shape as the primary source;
 * the engine iterates the battlefield twice (once
 * for the primary count, once for the andPer count)
 * and sums the two. v1 minimum is a single
 * secondary AND-source; an array form
 * (`andPer: [...]`) is a follow-up.
 */
function computeAnthemScalingCount(
  state: GameState,
  source: CardInstance,
  per: "creatures" | "treasures" | "lands" | "other_creatures",
  perSubtype?: string,
  andPer?:
    | {
        per: "creatures" | "treasures" | "lands" | "other_creatures";
        perSubtype?: string;
      }
    | undefined,
  perCounter?: { counter: string } | undefined,
): number {
  // Wave 4.8 follow-up 25 lane 32 piece 4/N (#2614
  // follow-up): the optional self-referential
  // per-counter count source. When set, REPLACES
  // the `per` arm's state-derived count with the
  // source's own per-counter count. The count is
  // `source.counters?.find(c => c.type === counter)?.count
  // ?? 0` — matches how
  // `evergreen-keywords.getEffectivePower` reads
  // the +1/+1 counter from the same field. v1
  // single counter type per anthem; a hybrid
  // "per creatures + per counter" arm is a follow-up.
  if (perCounter) {
    const counterEntry = source.counters?.find(
      (c) => c.type === perCounter.counter,
    );
    return counterEntry?.count ?? 0;
  }
  // Wave 4.8 follow-up 25 lane 32 piece 3/N (#2614
  // follow-up): the `"chosen"` sentinel for
  // `perSubtype`. When the field is the sentinel,
  // substitute `source.chosenCreatureType` (parallel
  // to `affects.subtype: "chosen"` reading the same
  // field). If `chosenCreatureType` is null (the
  // enter choice hasn't resolved yet), the count is
  // 0 (the scripted anthem remains inert — matches
  // lane 86 chosen-type anthem semantics).
  let resolvedPerSubtype: string | undefined = perSubtype;
  if (perSubtype === "chosen") {
    resolvedPerSubtype =
      source.chosenCreatureType !== null && source.chosenCreatureType !== undefined
        ? source.chosenCreatureType
        : undefined;
  }
  const subtypeLc = resolvedPerSubtype?.toLowerCase();
  const matchesSubtype = (card: CardInstance): boolean => {
    if (!subtypeLc) return true;
    return (card.cardData.type_line ?? "")
      .toLowerCase()
      .includes(subtypeLc);
  };
  // The lane 32 `per` enum is a superset of the lane 36
  // `X` enum (`creatures` / `treasures` / `lands`) with
  // one lane-32 addition: `other_creatures` excludes
  // the source itself. The four branches share an
  // iteration shape: every branch filters by `per` →
  // `controllerId` → optional `perSubtype` substring.
  // Inline branches keep the per-arm predicate
  // readable without re-implementing the underlying
  // `computeX` predicate set.
  let n = 0;
  for (const card of battlefieldCards(state)) {
    if (card.controllerId !== source.controllerId) continue;
    if (per === "other_creatures" && card.id === source.id) continue;
    if (
      (per === "creatures" || per === "other_creatures") &&
      !isCreature(card)
    ) {
      continue;
    }
    if (per === "treasures") {
      const t = (card.cardData.type_line ?? "").toLowerCase();
      if (!t.includes("treasure")) continue;
    }
    if (per === "lands") {
      const t = (card.cardData.type_line ?? "").toLowerCase();
      if (!t.includes("land")) continue;
    }
    if (!matchesSubtype(card)) continue;
    n++;
  }
  // Wave 4.8 follow-up 25 lane 32 piece 2/N: the
  // optional AND-source. Iterate the battlefield a
  // second time with the AND-source's `per` arm +
  // optional `perSubtype` filter, sum the count.
  // The secondary iteration uses the same
  // inline-predicate shape (no helper reuse — the
  // arm's `per` and `perSubtype` are independent
  // per iteration; a shared helper would have to
  // parameterize on two pairs, which obscures the
  // shape). v1 single secondary source; the OR
  // combinator (lane 36 `X.or`-style matrix) is a
  // follow-up.
  if (andPer) {
    // Wave 4.8 follow-up 25 lane 32 piece 3/N: the
    // `"chosen"` sentinel also applies to the
    // AND-source's `perSubtype`. Same resolution
    // (substitute `source.chosenCreatureType`,
    // count 0 when unset).
    let resolvedAndPerSubtype: string | undefined = andPer.perSubtype;
    if (andPer.perSubtype === "chosen") {
      resolvedAndPerSubtype =
        source.chosenCreatureType !== null &&
        source.chosenCreatureType !== undefined
          ? source.chosenCreatureType
          : undefined;
    }
    const andSubtypeLc = resolvedAndPerSubtype?.toLowerCase();
    const matchesAndSubtype = (card: CardInstance): boolean => {
      if (!andSubtypeLc) return true;
      return (card.cardData.type_line ?? "")
        .toLowerCase()
        .includes(andSubtypeLc);
    };
    for (const card of battlefieldCards(state)) {
      if (card.controllerId !== source.controllerId) continue;
      if (andPer.per === "other_creatures" && card.id === source.id) {
        continue;
      }
      if (
        (andPer.per === "creatures" || andPer.per === "other_creatures") &&
        !isCreature(card)
      ) {
        continue;
      }
      if (andPer.per === "treasures") {
        const t = (card.cardData.type_line ?? "").toLowerCase();
        if (!t.includes("treasure")) continue;
      }
      if (andPer.per === "lands") {
        const t = (card.cardData.type_line ?? "").toLowerCase();
        if (!t.includes("land")) continue;
      }
      if (!matchesAndSubtype(card)) continue;
      n++;
    }
  }
  return n;
}

/**
 * Wave 4.8 follow-up 12 lane 91 (#2614 follow-up): evaluate
 * a static's `while_condition` gate (CR 603.2 "while" clause,
 * parallel to a trigger's `whileCondition`). v1 supports two
 * shapes:
 *
 *   - `{ kind: "life_minimum", value: N }` — the gate evaluates
 *     true when the source's controller's life is `>= N`
 *     (Twinblade Paladin's "as long as you have 25 or more life,
 *     this creature has double strike and lifelink" half).
 *
 *   - `{ kind: "counter_minimum", counter, op, n }` — the gate
 *     evaluates true when the source's per-instance
 *     `card.instanceCounters[counter]` matches the comparator:
 *       - `op: "gte"` → `count >= n`
 *       - `op: "eq"`  → `count === n`
 *     Default count is `0` when `card.instanceCounters` is
 *     undefined (matches the lane 59 v1 default).
 *
 * Wave 4.8 follow-up 14 lane 57 (#2614 follow-up): adds the
 * `counter_minimum` arm for Redcap Gutter-Dweller's "Goblins
 * you control have menace as long as this has three or more
 * counters on it" half (`counter: "+1/+1", op: "gte", n: 3`).
 *
 * The controller path mirrors `computeX` (which also reads the
 * source's `controllerId`). The opponent-condition variant
 * ("as long as an opponent has less than X life") and the
 * threshold-style "you control [type]" variant ride future lanes.
 */
function evaluateStaticWhileCondition(
  cond:
    | { kind: "life_minimum"; value: number }
    | { kind: "counter_minimum"; counter: string; op: "gte" | "eq"; n: number },
  source: CardInstance,
  state: GameState,
): boolean {
  if (cond.kind === "life_minimum") {
    const player = state.players.get(source.controllerId);
    return player !== undefined && player.life >= cond.value;
  }
  if (cond.kind === "counter_minimum") {
    const count = source.instanceCounters?.[cond.counter] ?? 0;
    return cond.op === "gte" ? count >= cond.n : count === cond.n;
  }
  return false;
}

/** True when the static on `source` applies to `target` (CR 611.3a). */
export function staticAffects(
  stat: ScriptedStatic,
  source: CardInstance,
  target: CardInstance,
): boolean {
  // Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
  // a `death_replacement`-only static doesn't apply
  // per-target (it stamps the source's own
  // `deathReplacement` ledger; the consult reads it
  // later when a creature is dying). The `staticAffects`
  // check is irrelevant for this arm — return false so
  // the main loop skips per-target ledger writes for
  // death-replacement-only statics. The lane 61b write
  // happens in the dedicated `deathReplacements`
  // accumulation block, NOT in the per-target loop.
  if (stat.death_replacement !== undefined) return false;
  // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
  // a `grants.triggers`-only static doesn't apply
  // per-target (it stamps the source's own
  // `grantedTriggers` field via the dedicated
  // `grantedTriggersBySourceId` accumulation block;
  // the per-target P/T / keywords / etc. consult is
  // irrelevant for this arm). Short-circuit on the
  // missing-`affects` shape so the meta-static path
  // doesn't try to read `stat.affects.chosen_name_block`
  // on an undefined `affects` object.
  if (stat.grants !== undefined) return false;
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
  if (stat.affects?.chosen_name_block === true) {
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
  // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
  // `stat.affects` is now optional. Meta-statics with
  // alternative arms (grants / pure death_replacement)
  // already short-circuited at the top of the function.
  // Anything reaching the `affects`-shape branches
  // below is a "real" static carrying the standard
  // `affects` shape; the schema-side optional means
  // future meta-static arms may need their own short-
  // circuit, but v1 is conservative.
  if (!stat.affects) return false;
  if (stat.affects.add_creature_type !== undefined) {
    if (stat.affects.addCreatureTypeToSelf !== true) return false;
    if (source.id !== target.id) return false;
    if (stat.affects.add_creature_type === "chosen") {
      return source.chosenCreatureType !== null;
    }
    return true;
  }
  // Wave 4.8 follow-up 14 lane 51 (#2614 follow-up): the
  // permanent type-line overlay static
  // (`becomes_chosen_creature_type: true`). The source
  // overlays its OWN `cardData.type_line` permanently to
  // include its `chosenCreatureType` as a permanent
  // subtype (Adaptive Automaton's type-change half, in
  // addition to the lane 52 anthem-style addition). v1 is
  // self-only (parallels `add_creature_type` +
  // `addCreatureTypeToSelf`); the Aura-style
  // generalization rides a follow-up lane. The static
  // requires a resolved `chosenCreatureType`; otherwise
  // it's inert (the player hasn't answered the enter
  // choice yet). The actual `cardData.type_line` overlay
  // is performed by `refreshScriptedStatics` (this branch
  // only computes applicability).
  // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
  // `stat.affects` is now optional in the schema. Meta-
  // statics that ship a non-`affects` arm (grants,
  // pure death_replacement, etc.) need an early
  // return before the `affects` shape is read. By the
  // time we reach this line, the earlier
  // `stat.grants !== undefined` and
  // `stat.death_replacement !== undefined` short-
  // circuits already returned. Any affect-less
  // static reaching this point shouldn't apply to
  // this target; return false rather than crash on
  // the destructure below.
  if (!stat.affects) return false;
  if (stat.affects.becomes_chosen_creature_type === true) {
    if (source.id !== target.id) return false;
    return source.chosenCreatureType !== null;
  }
  // Wave 4.8 lane 55 (#2614 follow-up): the chosen-color
  // addition static. The source adds the named color (or
  // its `chosenColor`) to its own colors while on the
  // battlefield (Redcap Gutter-Dweller-style, parallel
  // to lane 52's `add_creature_type`). v1 is self-only —
  // the static returns true iff `source === target`. The
  // Aura-style "enchanted creature gains a color"
  // generalization rides a future lane. When the sentinel
  // `"chosen"` is in use the source also needs a resolved
  // `chosenColor`; otherwise the static is inert (the
  // player hasn't answered the enter choice yet). The
  // actual growth of `source.chosenColorAdditions` is
  // handled by `refreshScriptedStatics` (this branch only
  // computes applicability).
  if (stat.affects.add_color !== undefined) {
    if (stat.affects.addColorToSelf !== true) return false;
    if (source.id !== target.id) return false;
    if (stat.affects.add_color === "chosen") {
      return source.chosenColor !== null;
    }
    return true;
  }
  // Wave 4.8 follow-up 7 lane 75 (#2614 follow-up):
  // "as long as this is in play, it's a copy of [a chosen
  // permanent] until end of turn" (Sakashima-style /
  // manifested). The static is self-only — the source
  // copies itself onto itself, swapping its own printed
  // characteristics for the named target's. The actual
  // swap is performed by `refreshScriptedStatics` at the
  // bottom of the refresh pass; this branch only computes
  // applicability. The target must be on the battlefield
  // for the swap to take effect (the refresh pass checks
  // `state.cards.has(targetId)`); if the target has left,
  // the source restores its printed `cardData` from
  // `animatedUntilEndOfTurn`. v1 supports a single target
  // (the `target: CardInstanceId` is required); chosen-
  // target / named-card / nested-copy / copy-with-exception
  // variants are follow-up lanes (see `wave4-blockers.md`).
  if (stat.become_copy !== undefined) {
    if (source.id !== target.id) return false;
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
  // Wave 4.8 follow-up 14 lane 51 (#2614 follow-up): the
  // permanent-type-overlay consult. Cards that left the
  // battlefield drop their `permanentTypeOverlay` (the
  // chosen-type addition no longer applies) and restore
  // their printed `cardData.type_line` from the overlay
  // snapshot. Parallel to the
  // `restoreAnimatedOffBattlefield` consult at the top of
  // the pass.
  const state = restorePermanentTypeOverlay(
    restorePermanentCopyOffBattlefield(
      restoreAnimatedOffBattlefield(returnEarthbentLands(input)),
    ),
  );
  // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
  // build a snapshot of every card's "effective copy
  // target" (the leaf of its copy chain) BEFORE the
  // overlay write phase runs. A source whose
  // `become_copy` points at a target whose own
  // `become_copy` points at a third card overlays the
  // third card's printed `cardData` in a single pass;
  // a cyclic chain is broken by treating each member
  // of the cycle as if it had no `become_copy` arm.
  // The cycle guard consults the printed `cardData`
  // of each card it walks, so the snapshot is
  // independent of any in-flight overlay from a
  // prior pass.
  const copyChain = buildStaticCopyChainSnapshot(state);
  const onField = battlefieldCards(state);
  const sources: { card: CardInstance; statics: ScriptedStatic[] }[] = [];
  for (const card of onField) {
    // Wave 4.8 follow-up 23 lane 70 piece 2b (#2614 follow-up):
    // consult `printedCardDataOf(card).name` instead of
    // `card.cardData.name` so a card whose `cardData` is
    // overlaid by a `become_copy` static (EOT or permanent
    // arm) still resolves its own scripted statics on the
    // next refresh pass. Without this consult, the script
    // lookup `getCardScript(card.cardData.name)` returns
    // undefined when `card.cardData.name === target's
    // printed name` (the overlay) and the source is no
    // longer collected as a static source for the next
    // overlay write — the change-detection diff
    // short-circuits and the rollback never runs. The
    // EOT arm has the same issue (lane 75's collection
    // phase had the bug too — it relied on the
    // `restoreAnimatedOffBattlefield` consult at the
    // top of the pass to restore the overlay when the
    // target moved off BF). The permanent arm fixes
    // both at once because `printedCardDataOf` walks
    // either snapshot field.
    //
    // Lane 75's "target leaves the battlefield" test
    // (lane75-until-eot-copy.test.ts:362) historically
    // moved the target to a graveyard zone and asserted
    // that the overlay dropped. Lane 78 changed that
    // behavior — graveyard is a tracked zone, so the
    // overlay should persist per lane 78. The lane 78
    // commit (59d388e3) did not update the lane 75 test;
    // the test passed via the script-lookup bug (the
    // script wasn't found, the diff was a no-op, the
    // overlay was effectively absent on the next refresh).
    // The scoped-up update to that test is part of this
    // same commit — bringing the test in line with the
    // lane 78 tracked-zone semantics.
    const statics = getCardScript(printedCardDataOf(card).name)?.statics;
    if (statics) sources.push({ card, statics });
  }

  const pt = new Map<string, { power: number; toughness: number }>();
  const kws = new Map<string, string[]>();
  // Wave 4.8 follow-up 10 lane 77 (#2614 follow-up):
  // the leaf's per-instance `protectionFrom` rolled onto
  // the source's own protection ledger. Populated when
  // the overlay write phase rolls the leaf's
  // `protectionFrom` onto the source; consumed at the
  // bottom of the refresh pass when stamping the
  // `protectionFrom` field on the source's updated
  // state (union semantics: the source's own
  // static-driven protection AND the leaf's rolled
  // protection co-exist on the field). Cleared when
  // the overlay is dropped (cycle, target left,
  // source no longer has a `become_copy` static).
  const leafProtFromById = new Map<string, string[]>();
  // Wave 4.8 lane 52 (#2614 follow-up): per-card subtype
  // additions stamped by `affects.add_creature_type` statics.
  // The chosen-type anthem (lane 45) reads `subtypesOf(target)`
  // which unions these into the read at the next refresh pass
  // — so Adaptive Automaton's anthem path can match the
  // source against itself via the chosen creature type.
  const typeAdditions = new Map<string, string[]>();
  // Wave 4.8 lane 55 (#2614 follow-up): per-card color
  // additions stamped by `affects.add_color` statics. The
  // chosen-color anthem (lane 40) reads `getCardColors(target)`
  // which unions these into the read at the next refresh
  // pass (mirroring lane 52's `typeAdditions`).
  const colorAdditions = new Map<string, ("W" | "U" | "B" | "R" | "G")[]>();
  // Wave 4.8 follow-up 5 lane 71 (#2614 follow-up): the
  // per-card protection-from ledger stamped by statics with
  // a `protectionFrom` arm. The `hasProtectionFrom` helper
  // in `evergreen-keywords.ts` consults the field via the
  // existing `canBeTargetedBy` / `canBeBlocked` checks.
  const protFromById = new Map<string, string[]>();
  // Wave 4.8 follow-up 25 lane 71 piece 1/N (#2614 follow-up):
  // per-SOURCE protection-from ledger (multi-cast enforcement).
  // For each target with a static-driven protection grant,
  // maps each granting source's `CardInstanceId` to the
  // qualities IT grants (independent of other grants). The
  // `isProtectedFromSource` consult reads the per-source
  // ledger FIRST (a target granted protection from two
  // simultaneous Auras is protected from each Aura's quality
  // independently, NOT the union). When the source under
  // consult is not in the map, the union `protectionFrom`
  // field is consulted (the lane 71 piece 1/N + 2/N fallback).
  const protFromBySourceById = new Map<string, Record<string, string[]>>();
  // Wave 4.8 follow-up 7 lane 75 (#2614 follow-up): the
  // per-card copy-of-target ledger stamped by statics with
  // a `become_copy` arm. For each source with a
  // `become_copy` static, we record the named
  // `CardInstanceId`; the write phase at the bottom of the
  // refresh pass overlays the target's `cardData` (name,
  // type_line, power, toughness, colors, keywords) onto the
  // source's `cardData` and snapshots the source's printed
  // `cardData` under `animatedUntilEndOfTurn` so the
  // existing `clearUntilEndOfTurnPT` /
  // `restoreAnimatedOffBattlefield` rollback path restores
  // the printed characteristics at end of turn / when the
  // source leaves the battlefield. The overlay self-
  // corrects when the named target leaves the battlefield
  // (the refresh pass sees no copy from the target and
  // restores from `animatedUntilEndOfTurn`).
  // Wave 4.8 follow-up 7 lane 75 (#2614 follow-up):
  // per-card copy-of-target ledger stamped by statics
  // with a `become_copy` arm. The Wave 4.8 follow-up 8
  // lane 75b schema extends this with a `{ kind:
  // "name"; name: string }` arm for the
  // named-card-copy variant — the write-phase below
  // branches on `kind` (`"id"` uses
  // `state.cards.get(targetId)`; `"name"` looks up
  // the named card's `cardData` from the registry).
  // The overlay restores the printed `cardData` at
  // EOT or when the source leaves the battlefield via
  // the existing `clearUntilEndOfTurnPT` /
  // `restoreAnimatedOffBattlefield` rollback path.
  const copyOfTargetBySourceId = new Map<
    string,
    | { kind: "id"; targetId: string; until: "end_of_turn" | "permanent" }
    | { kind: "name"; name: string; until: "end_of_turn" | "permanent" }
  >();
  // Wave 4.8 follow-up 8 lane 75c (#2614 follow-up):
  // per-card copy-with-exception ledger. Each source
  // with a `become_copy: { exceptions: { add_subtype
  // } }` static gets an entry here; the write phase
  // rebuilds the source's overlaid `cardData.type_line`
  // to include the added subtypes after the lane 75 /
  // 75b overlay runs (parallel to lane 52's
  // `subtypesOf` helper unioning the printed subtypes
  // with `chosenTypeAdditions`). The "last write wins"
  // semantics carry over from lane 75 (a source is
  // unlikely to carry more than one such static). The
  // EOT cleanup step in `pt-until-end-of-turn.ts`
  // (`clearUntilEndOfTurnPT`) restores the printed
  // `cardData.type_line` (and the printed subtypes),
  // so the "until end of turn" semantics are honoured
  // for free.
  const copyExceptionsBySourceId = new Map<string, { addSubtype: string[] }>();
  for (const target of onField) {
    let power = 0;
    let toughness = 0;
    const granted = new Set<string>();
    const additions = new Set<string>();
    const colorAdds = new Set<"W"|"U"|"B"|"R"|"G">();
    // Wave 4.8 follow-up 5 lane 71 (#2614 follow-up): the
    // per-instance `protectionFrom` ledger for statics that
    // grant protection ("Creatures you control have
    // protection from red"). Collected alongside the other
    // per-instance ledgers; stamped on the target card at
    // the bottom of the pass. Read by `hasProtectionFrom`
    // in `evergreen-keywords.ts` alongside the parsed
    // keyword list and the regex fallback.
    const protFrom = new Set<string>();
    // Wave 4.8 follow-up 25 lane 71 piece 1/N (#2614 follow-up):
    // per-source ledger of protection qualities for multi-cast
    // enforcement. Maps each granting source's `CardInstanceId`
    // to the qualities it grants to THIS target. When a source
    // appears in `sources` with a `protectionFrom` arm that
    // matches the target, the source's `CardInstanceId` becomes
    // a key in this map and the source's qualities become the
    // value. The `isProtectedFromSource` consult reads this map
    // FIRST (independent per-source resolution).
    const protFromBySource: Record<string, string[]> = {};
    for (const { card, statics } of sources) {
      for (const stat of statics) {
        // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
        // skip statics without an `affects` arm. The
        // affects object is now optional (lane 112 makes
        // it possible to ship meta-statics like a grants
        // arm without an `affects` shape — the meta-static
        // applies at the source level via the dedicated
        // `grantedTriggersBySourceId` accumulation block,
        // NOT through the per-target P/T / keywords /
        // chosen-type / chosen-color arm consultations
        // below). The earlier `staticAffects` check
        // already short-circuits for the lane 112
        // meta-static, so this guard is a defensive
        // belt-and-suspenders.
        if (!stat.affects) continue;
        if (!staticAffects(stat, card, target)) continue;
        // Wave 4.8 follow-up 12 lane 91 (#2614 follow-up):
        // the `while_condition` gate is part of the static
        // (CR 603.2 "while" gate, parallel to a trigger's
        // while-gate). When the gate evaluates false, the
        // static's arms (power / toughness / keywords /
        // X / protectionFrom / become_copy / etc.) are
        // skipped — the static is inert for this pass.
        // v1 supports a single shape: `kind:
        // "life_minimum", value: N` — the static applies
        // when the source's controller's life is >= N.
        if (
          stat.while_condition &&
          !evaluateStaticWhileCondition(stat.while_condition, card, state)
        ) {
          continue;
        }
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
        // Wave 4.8 lane 55 (#2614 follow-up): grow the
        // target's `chosenColorAdditions` if this static
        // is a chosen-color addition and the source's
        // chosen color is resolved (or the literal form is
        // in use). Parallel to the lane 52 `add_creature_type`
        // block above. The local `getCardColors` helper
        // unions these into the read so the chosen-color
        // anthem (lane 40, Heraldic Banner / Diamond Mare)
        // can match the source against itself via the
        // added color.
        if (
          stat.affects.add_color !== undefined &&
          stat.affects.addColorToSelf === true
        ) {
          const addition =
            stat.affects.add_color === "chosen"
              ? card.chosenColor
              : stat.affects.add_color;
          if (addition) colorAdds.add(addition);
        }
        // Wave 4.8 follow-up 5 lane 71 (#2614 follow-up):
        // collect the static's `protectionFrom` qualities
        // onto the target's per-instance ledger. The
        // protection is a meta-static (no P/T, no
        // keywords, no P/T bonus); the
        // `hasProtectionFrom` check in
        // `evergreen-keywords.ts` consults the new
        // field. The set is deduplicated per-quality so
        // multiple statics granting the same color only
        // stamp once.
        if (stat.protectionFrom) {
          for (const q of stat.protectionFrom) protFrom.add(q);
          // Wave 4.8 follow-up 25 lane 71 piece 1/N:
          // per-source ledger stamp (multi-cast enforcement).
          // Track THIS source's granted qualities in
          // `protFromBySource[card.id]` so the consult
          // can resolve the source under query
          // independently of other grants. Multiple
          // `protectionFrom` arms on the same source
          // union (the union semantics mirror the
          // `protectionFrom` per-card ledger). The
          // `isProtectedFromSource` consult reads
          // `protFromBySource[source.id]` first; when
          // the source is present, the per-source
          // qualities are consulted (NOT the union).
          const existing = protFromBySource[card.id] ?? [];
          const merged = [...existing];
          for (const q of stat.protectionFrom) {
            if (!merged.includes(q)) merged.push(q);
          }
          protFromBySource[card.id] = merged;
        }
        // Wave 4.8 follow-up 7 lane 75 (#2614 follow-up):
        // record the `become_copy.target` for the source
        // itself (self-only, parallel to lane 52's
        // `add_creature_type` self-only semantics). The
        // last write wins when multiple statics on the
        // same source carry `become_copy` arms — a card
        // is unlikely to carry more than one such static
        // in v1, but the deterministic-overwrite is the
        // safe default. The write phase at the bottom of
        // the refresh pass reads this map and overlays
        // the target's characteristics onto the source's
        // `cardData` via the existing
        // `animatedUntilEndOfTurn` infra. The named
        // target must be on the battlefield for the
        // overlay to take effect (the refresh pass checks
        // `state.cards.has(targetId)` at write time).
        if (stat.become_copy !== undefined) {
          // Wave 4.8 follow-up 8 lane 75b (#2614
          // follow-up): the schema is a discriminated
          // union — `target: CardInstanceId` (lane 75)
          // or `named_card: { name: string }` (lane 75b).
          // The write phase below branches on the `kind`
          // tag. The "last write wins" semantics carry
          // over from lane 75.
          if ("target" in stat.become_copy) {
            copyOfTargetBySourceId.set(card.id, {
              kind: "id",
              targetId: stat.become_copy.target,
              until: stat.become_copy.until,
            });
          } else {
            copyOfTargetBySourceId.set(card.id, {
              kind: "name",
              name: stat.become_copy.named_card.name,
              until: stat.become_copy.until,
            });
          }
          // Wave 4.8 follow-up 8 lane 75c (#2614
          // follow-up): collect the copy-with-exception
          // arm (`exceptions.add_subtype`). v1 only
          // supports a single `add_subtype` list; the
          // write phase merges the listed subtypes onto
          // the source's overlaid `cardData.type_line`.
          // Both the lane 75 (chosen-target) and
          // lane 75b (named-card) arms support
          // `exceptions`.
          const ex = stat.become_copy.exceptions;
          if (ex && ex.add_subtype && ex.add_subtype.length > 0) {
            copyExceptionsBySourceId.set(card.id, {
              addSubtype: ex.add_subtype,
            });
          }
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
        // Wave 4.8 follow-up 23 lane 32 (#2614 follow-up):
        // the per-count P/T scaling modifier. The
        // `anthemScaling` arm combines with the integer
        // `power`/`toughness` arms — both contribute
        // (a "+1/+1 plus +1/+1 per creature" anthem is
        // a +2/+2 per creature, modeled as `power:
        // 1, anthemScaling: { per: "other_creatures",
        // perPower: 1, perToughness: 1 }`). The count
        // is computed once and applied to both P/T
        // arms (v1 single count source).
        if (stat.anthemScaling) {
          const count = computeAnthemScalingCount(
            state,
            card,
            stat.anthemScaling.per,
            stat.anthemScaling.perSubtype,
            // Wave 4.8 follow-up 25 lane 32 piece 2/N:
            // the optional AND-source is forwarded
            // through to the count consult. When unset
            // (the v1 default), the consult ignores
            // `andPer` and falls through to the
            // primary-source count.
            stat.anthemScaling.andPer,
            // Wave 4.8 follow-up 25 lane 32 piece 4/N:
            // the optional self-referential per-counter
            // arm. When set, the consult returns the
            // source's own per-counter count
            // (REPLACES the `per` arm entirely — the
            // v1 minimum is single-source scaling).
            stat.anthemScaling.perCounter,
          );
          power += count * (stat.anthemScaling.perPower ?? 0);
          toughness += count * (stat.anthemScaling.perToughness ?? 0);
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
    if (colorAdds.size > 0)
      colorAdditions.set(target.id, [...colorAdds].sort());
    if (protFrom.size > 0)
      protFromById.set(target.id, [...protFrom].sort());
    // Wave 4.8 follow-up 25 lane 71 piece 1/N: stamp the
    // per-source ledger (`Record<sourceId, string[]>`) on
    // `protFromBySourceById` when the target has any
    // source-specific grants. The write phase at the
    // bottom of the pass reads this map and overlays
    // it onto the card's `protectionFromBySource` field.
    if (Object.keys(protFromBySource).length > 0) {
      protFromBySourceById.set(target.id, protFromBySource);
    }
  }

  // Wave 4.8 follow-up 13 lane 61b (#2614 follow-up): the
  // printed-card death-replacement mechanism. The lane 61a
  // schema arm carries `replacement_effects` on a card's
  // script; the lane 61b mechanism carries a `static[].death_replacement`
  // arm instead, and the engine parses the source's
  // printed `cardData.oracle_text` to build the
  // `replacement_effects` entry. The result lands on
  // the source's per-instance `deathReplacement` ledger,
  // which `moveCardToZone`'s consult reads alongside
  // the lane 61a schema arm.
  const deathReplacements = new Map<
    string,
    ScriptedReplacementEffect[]
  >();
  for (const { card, statics } of sources) {
    if (!card.controllerId) continue;
    const cardDrs: ScriptedReplacementEffect[] = [];
    for (const st of statics) {
      if (!st.death_replacement) continue;
      const parsed = parsePrintedDeathReplacement(
        card.cardData.oracle_text,
        st.text,
        card.controllerId,
      );
      if (parsed) cardDrs.push(parsed);
    }
    if (cardDrs.length > 0) deathReplacements.set(card.id, cardDrs);
  }

  // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
  // the SELF-GRANT triggered-ability arm of
  // `StaticSchema`. A permanent's own
  // `static[].grants.triggers` list is collected here
  // and stamped on the SOURCE's per-instance
  // `grantedTriggers` field (CR 603.2 grant
  // semantics). The trigger fire path
  // (`detectTriggeredAbilities` in
  // `abilities/triggered.ts`) already reads
  // `card.grantedTriggers` (the lane 65 Aura-shaped
  // path) and fires each granted trigger alongside
  // the card's own scripted triggers — so the lane
  // 112 v1 minimum only needs the collection + stamp
  // step here; the fire path is unchanged. The
  // granted trigger's `event` is `dies`, parallel to
  // the lane 65 v1 minimum.
  const grantedTriggersBySourceId = new Map<
    CardInstanceId,
    Array<{
      event: "dies";
      effects: Array<{ op: string; [k: string]: unknown }>;
      from: CardInstanceId;
      sourceControllerId: PlayerId;
    }>
  >();
  for (const { card, statics } of sources) {
    if (!card.controllerId) continue;
    const grantedList: Array<{
      event: "dies";
      effects: Array<{ op: string; [k: string]: unknown }>;
      from: CardInstanceId;
      sourceControllerId: PlayerId;
    }> = [];
    for (const st of statics) {
      const triggers = st.grants?.triggers;
      if (!triggers || triggers.length === 0) continue;
      for (const t of triggers) {
        grantedList.push({
          event: t.event,
          effects: t.effects as Array<{
            op: string;
            [k: string]: unknown;
          }>,
          from: card.id,
          sourceControllerId: card.controllerId,
        });
      }
    }
    if (grantedList.length > 0) {
      grantedTriggersBySourceId.set(card.id, grantedList);
    }
  }


  let cards: GameState["cards"] | null = null;
  for (const [cardId, card] of state.cards) {
    const nextPT = pt.get(cardId);
    const nextKw = kws.get(cardId) ?? [];
    const nextAdds = typeAdditions.get(cardId);
    const nextColors = colorAdditions.get(cardId);
    const nextDr = deathReplacements.get(cardId);
    const nextProtFrom = protFromById.get(cardId);
    // Wave 4.8 follow-up 25 lane 71 piece 1/N (#2614 follow-up):
    // the per-source ledger is read in parallel with the
    // union `protectionFrom`. When the source under consult
    // has its own entry, `isProtectedFromSource` resolves
    // the source's per-source qualities independently.
    const nextProtFromBySource = protFromBySourceById.get(cardId);
    // Wave 4.8 follow-up 10 lane 77 (#2614 follow-up):
    // the rolled leaf `protectionFrom` (union semantics
    // with `nextProtFrom` — the source's own
    // static-driven protection is preserved alongside
    // the leaf's rolled protection). Empty when no
    // overlay is in effect (the overlay write phase
    // clears the entry on cycle / target-left /
    // static-removed).
    const leafProtFrom = leafProtFromById.get(cardId);
    const prevKw = card.scriptStaticKeywords ?? [];
    const prevAdds = card.chosenTypeAdditions ?? [];
    const prevColors = card.chosenColorAdditions ?? [];
    const prevProtFrom = card.protectionFrom ?? [];
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
    // Wave 4.8 lane 55 (#2614 follow-up): same shape for
    // chosen-color additions (sorted color-letter array).
    const sameColors =
      (nextColors ? nextColors.length : 0) === prevColors.length &&
      (nextColors ?? []).every((c, i) => c === prevColors[i]);
    // Wave 4.8 follow-up 5 lane 71 (#2614 follow-up): same
    // shape for the per-instance `protectionFrom` ledger
    // (sorted quality-name array). The change-detection
    // diff compares the previous and next arrays element-
    // by-element so the refresh pass only re-stamps when
    // the protection actually changed.
    //
    // Wave 4.8 follow-up 10 lane 77 (#2614 follow-up):
    // the diff compares the UNION of the source's own
    // static-driven protection AND the leaf's rolled
    // protection. The rolled protection is unioned at
    // write time (see below) — here the diff just
    // compares the resulting union against the previous
    // ledger so the refresh pass only re-stamps when
    // the rolled protection actually changed (a leaf
    // adding a new quality, a leaf's protection
    // dropping, the source acquiring a new
    // `become_copy` target that picks up a fresh
    // leaf's protection, etc.).
    const mergedProtFrom: string[] = [];
    if (nextProtFrom) mergedProtFrom.push(...nextProtFrom);
    if (leafProtFrom) mergedProtFrom.push(...leafProtFrom);
    const sameProtFrom =
      mergedProtFrom.length === prevProtFrom.length &&
      mergedProtFrom.every((q, i) => q === prevProtFrom[i]);
    // Wave 4.8 follow-up 25 lane 71 piece 1/N: per-source
    // ledger diff. Compares the previous `Record<...>` (or
    // undefined) against the next per-source map; a change
    // in either direction triggers a re-stamp. The
    // `JSON.stringify`-based comparison is sufficient for
    // the v1 minimum — keys are `CardInstanceId` strings
    // and values are stable string arrays.
    const prevProtFromBySource = card.protectionFromBySource ?? null;
    let sameProtFromBySource = true;
    if (nextProtFromBySource === undefined && prevProtFromBySource === null) {
      sameProtFromBySource = true;
    } else if (nextProtFromBySource === undefined) {
      sameProtFromBySource = false;
    } else if (prevProtFromBySource === null) {
      sameProtFromBySource = false;
    } else {
      const nextKeys = Object.keys(nextProtFromBySource).sort();
      const prevKeys = Object.keys(prevProtFromBySource).sort();
      if (nextKeys.length !== prevKeys.length) {
        sameProtFromBySource = false;
      } else {
        for (const k of nextKeys) {
          if (prevKeys.indexOf(k) === -1) {
            sameProtFromBySource = false;
            break;
          }
          const n = [...(nextProtFromBySource[k] ?? [])].sort();
          const p = [...(prevProtFromBySource[k] ?? [])].sort();
          if (
            n.length !== p.length ||
            !n.every((q, i) => q === p[i])
          ) {
            sameProtFromBySource = false;
            break;
          }
        }
      }
    }
    // Wave 4.8 follow-up 7 lane 75 (#2614 follow-up): the
    // per-instance `copyOfTargetId` is part of the change-
    // detection diff so the refresh pass re-stamps the card
    // only when the copy target actually changed. Compare
    // the previous `copyOfTargetId` (or undefined) against
    // the next `copyOfTargetBySourceId` (or undefined). A
    // change in either direction (target acquired, target
    // dropped) triggers the re-stamp.
    //
    // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
    // the `setByAura` marker exempts the card from the
    // diff's "drop stale overlay" branch. The Aura
    // overlay is the canonical site for the
    // enchanted card's overlay; the static refresh
    // between Aura refreshes must not tear it down.
    // The marker is set by `refreshAuraBonuses` (lane
    // 75d); the static refresh reads it and skips the
    // drop branch.
    const nextCopyOfTargetId = copyOfTargetBySourceId.get(cardId);
    const prevCopyOfTargetId = card.copyOfTargetId;
    const sameCopyOfTarget = nextCopyOfTargetId === prevCopyOfTargetId;
    // Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
    // the `deathReplacement` ledger is part of the
    // change-detection diff. The per-instance array is
    // built from `deathReplacements` of THIS source's
    // own `static[].death_replacement` arms (a source
    // stamps the ledger ON ITSELF, never on a target —
    // the consult reads the source's own `deathReplacement`
    // for the per-consult effect list).
    const prevDr = card.deathReplacement ?? [];
    const nextDrLen = nextDr?.length ?? 0;
    const sameDr =
      nextDrLen === prevDr.length &&
      (nextDr ?? []).every(
        (e, i) =>
          e.text === prevDr[i]?.text &&
          e.event === prevDr[i]?.event &&
          e.redirect.to === prevDr[i]?.redirect.to,
      );
    // Wave 4.8 follow-up 14 lane 51 (#2614 follow-up):
    // the per-instance `permanentTypeOverlay` overlay
    // and `cardData.type_line` are part of the
    // change-detection diff so the refresh pass only
    // re-stamps the card when the overlay actually
    // changed. When the overlay is active the
    // expected type_line is the rebuilt printed +
    // chosen type; when it's inactive the expected
    // state is `permanentTypeOverlay === undefined`.
    const overlayActive = sourceHasBecomesChosenCreatureType(card, sources);
    const sameTypeOverlay = overlayActive
      ? card.cardData.type_line ===
          rebuildTypeLineWithAddedSubtypes(
            (card.permanentTypeOverlay?.cardData ?? card.cardData).type_line,
            [card.chosenCreatureType as string],
          ) &&
        card.permanentTypeOverlay?.source === card.id
      : card.permanentTypeOverlay === undefined;
    // When the card has a `setByAura` overlay AND no
    // static-driven `become_copy` arm, the diff is
    // considered a no-op: the Aura refresh will
    // re-stamp the overlay on its next pass. The
    // `cardData` and `animatedUntilEndOfTurn` are
    // preserved as-is.
    const auraOverlayActive =
      card.animatedUntilEndOfTurn?.setByAura === true &&
      nextCopyOfTargetId === undefined;
    // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
    // the `grantedTriggers` self-grant diff. The lane 65
    // Aura-shaped path compares `card.grantedTriggers`
    // against `nextGrantedTriggers` (the lane 65 map); the
    // lane 112 self-grant path compares the same field
    // against `nextSelfGrantedTriggers` (the lane 112
    // map). The combined write at the bottom of the
    // refresh pass unions any existing Aura-driven
    // grants (carried over from `updated.grantedTriggers`
    // after the Aura path ran earlier in the
    // orchestrator's pass order) with the lane 112
    // self-grants; the diff compares the previous field
    // against the unioned next value to decide whether
    // to skip the no-op write.
    const nextSelfGrantedTriggers_DIFF =
      grantedTriggersBySourceId.get(cardId) ?? [];
    const wasSelfGrantedTriggers_DIFF = card.grantedTriggers ?? [];
    const sameSelfGrantedTriggers =
      nextSelfGrantedTriggers_DIFF.length === wasSelfGrantedTriggers_DIFF.length &&
      nextSelfGrantedTriggers_DIFF.every(
        (g, i) =>
          wasSelfGrantedTriggers_DIFF[i] &&
          wasSelfGrantedTriggers_DIFF[i].event === g.event &&
          wasSelfGrantedTriggers_DIFF[i].from === g.from &&
          wasSelfGrantedTriggers_DIFF[i].sourceControllerId ===
            g.sourceControllerId &&
          JSON.stringify(wasSelfGrantedTriggers_DIFF[i].effects) ===
            JSON.stringify(g.effects),
      );
    // trace removed

    if (
      samePT &&
      sameKw &&
      sameAdds &&
      sameColors &&
      sameProtFrom &&
      sameProtFromBySource &&
      sameCopyOfTarget &&
      sameDr &&
      sameTypeOverlay &&
      sameSelfGrantedTriggers
    ) {
      // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
      // if the card has an Aura-driven overlay and no
      // static-driven `become_copy` arm, skip the
      // re-stamp entirely. The Aura refresh is the
      // canonical site; the static refresh between
      // Aura refreshes must not tear down the
      // overlay. The marker is set by
      // `refreshAuraBonuses`; the EOT cleanup
      // (`clearUntilEndOfTurnPT`) drops the overlay
      // when the turn ends.
      if (auraOverlayActive) continue;
      continue;
    }
    // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
    // skip cards with an active Aura-driven overlay
    // and no static-driven `become_copy` arm. The
    // Aura refresh is the canonical site for the
    // enchanted card's overlay; the static refresh
    // should not touch the overlay's `cardData`,
    // `animatedUntilEndOfTurn`, or `copyOfTargetId`.
    // The static refresh will re-stamp any non-overlay
    // diff (P/T, keywords) on the next pass, but the
    // Aura overlay is preserved.
    if (auraOverlayActive) continue;
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
    // Wave 4.8 lane 55: clear `chosenColorAdditions` when
    // the source has left the battlefield. Same
    // battlefield-zone-only semantics as
    // `chosenTypeAdditions`. The local `getCardColors`
    // helper unions these with the printed colors.
    if (nextColors && nextColors.length > 0)
      updated.chosenColorAdditions = nextColors;
    else delete updated.chosenColorAdditions;
    // Wave 4.8 follow-up 14 lane 51 (#2614 follow-up):
    // the permanent type-line overlay (Adaptive
    // Automaton's "is the chosen type in addition to its
    // other types" half). When the source's
    // `becomes_chosen_creature_type` static matches and
    // `source.chosenCreatureType` is resolved, the
    // engine rebuilds the source's
    // `cardData.type_line` to include the chosen type
    // alongside the printed subtypes (parallel to the
    // lane 75c `rebuildTypeLineWithAddedSubtypes` helper
    // but persistent — no EOT cleanup). The original
    // printed `cardData` is stashed under
    // `permanentTypeOverlay.cardData` so the
    // `restorePermanentTypeOverlay` consult at the top
    // of the refresh pass can restore it when the card
    // leaves the battlefield. When the static is no
    // longer active (the source left the battlefield,
    // or `chosenCreatureType` is now null), the overlay
    // is dropped and the original `cardData.type_line`
    // is restored from the snapshot. The lane 51 arm
    // is additive: it stamps a permanent subtype on
    // top of the printed type line WITHOUT replacing
    // any of the printed subtypes. The overlay
    // self-corrects on the next refresh pass — the
    // refresh computes the same overlay from
    // `source.chosenCreatureType` and re-stamps the
    // `cardData.type_line` via `rebuildTypeLineWithAddedSubtypes`.
    // v1 supports a single permanent overlay per card
    // (parallel to the lane 52 self-only semantics);
    // the Aurora-shape generalization rides a
    // follow-up lane.
    if (sourceHasBecomesChosenCreatureType(card, sources)) {
      const chosen = card.chosenCreatureType;
      if (chosen !== null) {
        // Source IS on the battlefield with a resolved
        // `chosenCreatureType`: apply / refresh the
        // permanent overlay.
        //
        // The snapshot that is stashed under
        // `permanentTypeOverlay.cardData` is the
        // printed (pre-overlay) `cardData`. The
        // printed value must NOT be the in-flight
        // (overlaid) `cardData.type_line` (otherwise
        // a refresh that didn't re-derive the
        // overlay would re-stamp the same overlaid
        // line, and the original printed subtypes
        // would be lost). The helper
        // `rebuildTypeLineWithAddedSubtypes` reads
        // the typed input and adds the chosen
        // subtype alongside the printed subtypes.
        const printed = card.permanentTypeOverlay?.cardData ?? card.cardData;
        updated.cardData = {
          ...printed,
          type_line: rebuildTypeLineWithAddedSubtypes(
            printed.type_line,
            [chosen],
          ),
        };
        updated.permanentTypeOverlay = {
          cardData: printed,
          source: card.id,
        };
      }
    } else if (card.permanentTypeOverlay) {
      // The source's `becomes_chosen_creature_type`
      // static is no longer active (the source left
      // the battlefield, or the chosen creature type
      // is now null). Restore the original
      // `cardData.type_line` from the snapshot and
      // drop the overlay marker. Matches the
      // natural battlefield-zone-only semantics.
      updated.cardData = card.permanentTypeOverlay.cardData;
      delete updated.permanentTypeOverlay;
    }
    // Wave 4.8 follow-up 5 lane 71 (#2614 follow-up): the
    // per-instance `protectionFrom` field is part of the
    // write phase. The clear-when-source-leaves semantics
    // mirror `chosenTypeAdditions` /
    // `chosenColorAdditions` (battlefield-zone-only). The
    // `hasProtectionFrom` helper reads the field via the
    // existing `canBeTargetedBy` / `canBeBlocked` checks.
    //
    // Wave 4.8 follow-up 10 lane 77 (#2614 follow-up):
    // the write is moved AFTER the overlay write phase
    // (the rolled leaf `protectionFrom` is populated by
    // the overlay write, so the bottom write needs to
    // run AFTER that). The post-overlay-write block
    // below (just before `cards.set`) re-stamps
    // `updated.protectionFrom` with the full union.
    // Wave 4.8 follow-up 7 lane 75 (#2614 follow-up):
    // overlay the source's `cardData` with the named
    // target's printed characteristics when the source
    // carries a `become_copy` static. The refresh pass
    // self-corrects when the target leaves the
    // battlefield (the source restores its printed
    // `cardData` from `animatedUntilEndOfTurn`). The
    // EOT cleanup step in `pt-until-end-of-turn.ts`
    // (`clearUntilEndOfTurnPT`) also undoes the overlay
    // when the turn ends, restoring the source's printed
    // characteristics via the existing
    // `animatedUntilEndOfTurn` rollback path — so the
    // "until end of turn" semantics are honoured for free.
    //
    // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
    // the cycle guard. A source whose `become_copy`
    // points at a target whose own `become_copy` points
    // at a third card overlays the LEAF's printed
    // `cardData` in a single pass; a cyclic chain is
    // broken by dropping the overlay on every cycle
    // member. The snapshot was built at the top of the
    // refresh pass — before any overlay writes — and
    // consulted here. The snapshot's `leafCardData` is
    // the value the overlay write phase copies onto the
    // source's `cardData`; reading the snapshot (rather
    // than the in-flight `target.cardData`) is what
    // makes the chain resolve consistently across
    // refreshes.
    const nextCopyTarget = copyOfTargetBySourceId.get(cardId);
    if (nextCopyTarget !== undefined) {
      // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
      // cycle guard — drop the overlay for any source
      // whose copy chain forms a cycle. The cycle
      // member is treated as if it had no `become_copy`
      // arm: the source's printed `cardData` is restored
      // and the copy ledger is cleared.
      if (copyChain.cycleIds.has(cardId)) {
        if (card.animatedUntilEndOfTurn) {
          updated.cardData = card.animatedUntilEndOfTurn.cardData;
          delete updated.animatedUntilEndOfTurn;
          delete updated.copyOfTargetId;
        } else {
          // No prior overlay — the static-driven
          // overlay is suppressed for this pass. The
          // copy ledger is cleared.
          delete updated.copyOfTargetId;
        }
        // Wave 4.8 follow-up 10 lane 77 (#2614
        // follow-up): drop any leaf-rolled
        // `protectionFrom` — the cycle case
        // suppresses the overlay entirely, so the
        // source's own static-driven protection is
        // the only protection left.
        leafProtFromById.delete(cardId);
        // Lane 77: stamp the cycle card's
        // `protectionFrom` with the source's own
        // static-driven protection (the cycle drops
        // the leaf-rolled protection; the final value
        // is just `nextProtFrom`).
        if (nextProtFrom && nextProtFrom.length > 0) {
          updated.protectionFrom = [...nextProtFrom];
        } else if ("protectionFrom" in updated) {
          delete updated.protectionFrom;
        }
        // Wave 4.8 follow-up 25 lane 71 piece 1/N
        // (#2614 follow-up): per-source ledger
        // parallel — the cycle case drops the
        // leaf-rolled protection but preserves
        // per-source grants (each source's
        // contribution stays independent).
        if (
          nextProtFromBySource &&
          Object.keys(nextProtFromBySource).length > 0
        ) {
          updated.protectionFromBySource = nextProtFromBySource;
        } else if ("protectionFromBySource" in updated) {
          delete updated.protectionFromBySource;
        }
        // Skip the rest of the write phase for this
        // card; the cycle case is fully handled here.
        cards.set(cardId, updated);
        continue;
      }
      // Wave 4.8 follow-up 8 lane 75b (#2614 follow-up):
      // the per-source copy-of-target ledger is a tagged
      // union. For `kind: "id"` (lane 75), the named
      // target is on the battlefield — its
      // `cardData` provides the overlay source. For
      // `kind: "name"` (lane 75b), the named card's
      // `cardData` is fetched from the synchronous
      // `cardDataByName` registry (a missing named card
      // is a no-op — the source keeps its printed
      // `cardData`).
      //
      // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
      // when the snapshot has a leaf entry for this
      // source, the overlay consults the LEAF's printed
      // `cardData` rather than the immediate target's
      // in-flight `cardData`. A nested copy chain (the
      // immediate target has its own `become_copy` arm)
      // is resolved in one pass: the source overlays the
      // leaf's printed characteristics. Without the
      // snapshot, the source would copy the in-flight
      // overlay on the intermediate target — which is
      // whatever the intermediate target's overlay is
      // currently showing, not the printed value.
      let targetPrintedCardData: ScryfallCard | undefined;
      let nextTargetLedger: string | undefined;
      const leafFromSnapshot = copyChain.leafBySourceId.get(cardId);
      const leafCardDataFromSnapshot =
        copyChain.leafCardDataBySourceId.get(cardId);
      if (nextCopyTarget.kind === "id") {
        const target = state.cards.get(nextCopyTarget.targetId);
        // Wave 4.8 follow-up 10 lane 78 (#2614 follow-up):
        // the target's "in a tracked zone" check. v1 used
        // `currentZoneKey?.endsWith("-battlefield")` which
        // dropped the overlay when the target was in any
        // non-battlefield zone (graveyard, exile, hand,
        // library, command). Lane 78 removes the
        // battlefield-only constraint — the overlay is
        // applied for any target whose zone is in
        // `state.zones` (a "tracked zone"). Cross-zones
        // copy is battlefield-zone-only for the SOURCE
        // (the source must be on the battlefield for the
        // static to apply — the static walk iterates
        // `onField`), but the target can be in any zone
        // the engine tracks (CR 707.2 "copy a card that's
        // not in play"). An untracked zone (a key not in
        // `state.zones`, e.g. a non-existent zone) drops
        // the overlay.
        const targetInTrackedZone = target
          ? target.currentZoneKey !== null &&
            state.zones.has(target.currentZoneKey)
          : false;
        if (target && targetInTrackedZone) {
          // Use the snapshot's leaf `cardData` when
          // available (lane 75e: nested-copy chain
          // resolved in one pass); fall back to the
          // immediate target's printed `cardData` when
          // the chain has no further extension (the
          // immediate target IS the leaf, or the chain
          // terminated because the leaf has no
          // `become_copy` arm).
          targetPrintedCardData =
            leafCardDataFromSnapshot ??
            (target.animatedUntilEndOfTurn?.cardData ?? target.cardData);
          // The ledger stays as the IMMEDIATE target's
          // id (the source's `become_copy` references
          // the immediate target, not the leaf — the
          // change-detection diff compares the ledger
          // against the per-pass `copyOfTargetBySourceId`
          // value to detect script changes; the leaf is
          // a snapshot-only construct).
          nextTargetLedger = nextCopyTarget.targetId;
          // Mark the source as having an in-flight
          // overlay so the next refresh pass's snapshot
          // resolution continues to walk the chain
          // until the leaf — the snapshot helper
          // consults `card.copyOfTargetId` to follow
          // the chain. The leaf entry is the value the
          // overlay write phase copies onto the source.
          if (leafFromSnapshot && leafFromSnapshot !== nextTargetLedger) {
            // The chain has a leaf; the source's
            // `copyOfTargetId` is the immediate target
            // (matches `nextTargetLedger`). The next
            // refresh pass's snapshot will walk the
            // chain from the source's ledger through
            // the immediate target to the leaf.
          }
        }
      } else {
        // Wave 4.8 follow-up 8 lane 75b — named-card
        // lookup. The named card is NOT required to be
        // on the battlefield (Memnarch / Clone Shell
        // shape). Missing name is a no-op.
        const namedCardData = getCardDataByName(nextCopyTarget.name);
        if (namedCardData) {
          targetPrintedCardData = namedCardData;
          // For the lane 75b ledger we use the named
          // card's name (string) as a stable ledger
          // tag; the change-detection diff below compares
          // `card.copyOfTargetId` so the value just
          // needs to differ on a re-name.
          nextTargetLedger = `name:${nextCopyTarget.name}`;
        }
      }
      if (targetPrintedCardData !== undefined && nextTargetLedger !== undefined) {
        // trace removed
        // Wave 4.8 follow-up 23 lane 70 piece 2a (#2614
        // follow-up): the "becomes a copy of [X] forever"
        // permanent arm takes a separate write path. v1
        // stamps the per-instance `copyOfTargetIdPermanent`
        // ledger but does NOT overlay `cardData` (the
        // cardData overlay rides lane 70 piece 2b — the
        // `permanentCopyPrintedCardData` field + name /
        // type_line / P/T / colors / keywords overlay +
        // battlefield-leave cleanup). The early `continue`
        // keeps the EOT overlay, the EOT rollback, and the
        // lane 75e cycle guard at the BOTTOM (the
        // `cycleIds` check at line 1232) untouched — the
        // permanent arm inherits the same cycle-guard
        // semantics as lane 75e by virtue of routing
        // through `copyChain.cycleIds.has(cardId)` above
        // the overlay block.
        if (nextCopyTarget.until === "permanent") {
          // Wave 4.8 follow-up 23 lane 70 piece 2b
          // (#2614 follow-up): the `cardData` overlay
          // for the `until: "permanent"` arm. Snapshots
          // the source's printed `cardData` (the one the
          // source had BEFORE the first overlay — the
          // `permanentCopyPrintedCardData` field is the
          // rollback reference) and overwrites the
          // source's `cardData` with the target's
          // printed name / type_line / P/T / colors /
          // color_identity / keywords (CR 707.2 "all
          // characteristics copied"). mana_cost, cmc,
          // oracle_text, and other metadata are
          // deliberately NOT copied — they are the
          // spell's defining characteristics, not the
          // on-battlefield copy semantics.
          //
          // The snapshot's "printed" reference is the
          // current `card.cardData` (NOT
          // `permanentCopyPrintedCardData` — the
          // re-stamp case must NOT overwrite an existing
          // snapshot with the overlaid cardData, or the
          // rollback would restore the overlay). The
          // snapshot helper is idempotent on equality so
          // a refresh pass that re-stamps the same target
          // returns the input object.
          const printed = card.cardData;
          const snapshotted = snapshotPermanentCopyPrintedCardData(
            updated,
            printed,
          );
          const overlaid = {
            ...snapshotted,
            cardData: {
              ...printed,
              name: targetPrintedCardData.name,
              type_line: targetPrintedCardData.type_line,
              power: targetPrintedCardData.power,
              toughness: targetPrintedCardData.toughness,
              colors: targetPrintedCardData.colors,
              color_identity: targetPrintedCardData.color_identity,
              keywords: targetPrintedCardData.keywords,
            },
          };
          const stamped = setPermanentCopyOf(
            overlaid,
            nextTargetLedger,
          );
          cards.set(cardId, stamped);
          continue;
        }
        // Snapshot the source's printed `cardData`
        // (the one stored in `animatedUntilEndOfTurn`
        // if a copy was already in effect, else the
        // current `cardData`). The pattern mirrors
        // `animateUntilEndOfTurn` so the
        // `restoreAnimatedOffBattlefield` /
        // `clearUntilEndOfTurnPT` rollback paths
        // restore the printed characteristics without
        // any additional wiring.
        const printed =
          card.animatedUntilEndOfTurn?.cardData ?? card.cardData;
        updated.animatedUntilEndOfTurn = {
          cardData: printed,
        };
        // Overlay the target's printed characteristics
        // onto the source's `cardData`. v1 copies
        // name, type_line, power, toughness, colors,
        // and keywords — "all characteristics copied"
        // (CR 707.2). mana_cost, cmc, oracle_text,
        // and other metadata are deliberately NOT
        // copied — they're the spell's defining
        // characteristics, not the on-battlefield
        // copy semantics.
        updated.cardData = {
          ...printed,
          name: targetPrintedCardData.name,
          type_line: targetPrintedCardData.type_line,
          power: targetPrintedCardData.power,
          toughness: targetPrintedCardData.toughness,
          colors: targetPrintedCardData.colors,
          color_identity: targetPrintedCardData.color_identity,
          keywords: targetPrintedCardData.keywords,
        };
        // Wave 4.8 follow-up 8 lane 75c (#2614
        // follow-up): copy-with-exception merge.
        // After the lane 75 / 75b overlay writes
        // the target's printed characteristics,
        // apply the lane 75c exception by
        // rebuilding the overlaid `type_line`
        // to include any added subtypes. Phyrexian
        // Metamorph's "It's also a Phyrexian in
        // addition to its other types" is the
        // canonical example: the overlay sets
        // `type_line: "Creature — Shapeshifter"`
        // (the chosen creature's printed type
        // line), and the exception appends
        // "Phyrexian" to the subtype list,
        // producing `type_line: "Creature —
        // Shapeshifter Phyrexian"`. v1 supports a
        // single `add_subtype` list; multi-shape
        // exceptions (`add_color`, `add_power`,
        // `add_type`) are follow-up lanes.
        const exceptions = copyExceptionsBySourceId.get(cardId);
        if (exceptions && exceptions.addSubtype.length > 0) {
          updated.cardData = {
            ...updated.cardData,
            type_line: rebuildTypeLineWithAddedSubtypes(
              updated.cardData.type_line,
              exceptions.addSubtype,
            ),
          };
        }
        updated.copyOfTargetId = nextTargetLedger;
        // Wave 4.8 follow-up 10 lane 77 (#2614
        // follow-up): roll the leaf's per-instance
        // `protectionFrom` onto the source. The
        // snapshot's `leafPerInstanceBySourceId`
        // carries the leaf's `protectionFrom`
        // (populated by the previous pass's
        // `refreshScriptedStatics` write). The rolled
        // value is read at the bottom of the pass and
        // unioned with the source's own
        // static-driven `protectionFrom`. Multiple
        // `become_copy` overlays stack their
        // protection (the union semantics preserve
        // every leaf's contribution across refreshes).
        const leafPerInstance =
          copyChain.leafPerInstanceBySourceId.get(cardId);
        if (
          leafPerInstance?.protectionFrom &&
          leafPerInstance.protectionFrom.length > 0
        ) {
          leafProtFromById.set(cardId, [
            ...leafPerInstance.protectionFrom,
          ]);
        } else {
          leafProtFromById.delete(cardId);
        }
      } else if (card.animatedUntilEndOfTurn) {
        // Target has left the battlefield / named
        // card missing. Restore the source's printed
        // `cardData` and clear the copy ledger.
        updated.cardData = card.animatedUntilEndOfTurn.cardData;
        delete updated.animatedUntilEndOfTurn;
        delete updated.copyOfTargetId;
        // Wave 4.8 follow-up 10 lane 77 (#2614
        // follow-up): drop any leaf-rolled
        // `protectionFrom` — the overlay is gone,
        // the source's own static-driven protection
        // is the only protection left.
        leafProtFromById.delete(cardId);
      } else if (
        card.copyOfTargetIdPermanent !== undefined ||
        card.permanentCopyPrintedCardData !== undefined
      ) {
        // Wave 4.8 follow-up 23 lane 70 piece 2a +
        // piece 2b (#2614 follow-up): the
        // permanent-arm rollback. The permanent arm
        // writes both the `copyOfTargetIdPermanent`
        // ledger AND the `permanentCopyPrintedCardData`
        // snapshot; the "target missing" branch
        // restores the source's printed `cardData`
        // from the snapshot AND clears both fields
        // (so the source returns to its untouched
        // printed state). The `restorePermanentCopyOff
        // Battlefield` consult at the TOP of the
        // refresh pass handles the source-leaves-
        // battlefield case; this branch is for the
        // target-leaves case (where the source is
        // still on the battlefield with a now-stale
        // permanent-copy ledger pointing at a missing
        // target).
        const restored: CardInstance = {
          ...updated,
          cardData:
            card.permanentCopyPrintedCardData ?? card.cardData,
        };
        const cleared = clearPermanentCopyOf(
          clearPermanentCopyPrintedCardData(restored),
        );
        cards.set(cardId, cleared);
        continue;
      } else {
        // Source has never had a copy overlay; no-op.
        // (The `else if` branch below would also
        // fire on a `become_copy` static going
        // away — that's the expected behavior.)
        delete updated.copyOfTargetId;
        // Wave 4.8 follow-up 10 lane 77: no prior
        // overlay → no rolled protection to clear.
      }
    } else if (
      card.copyOfTargetId !== undefined ||
      card.animatedUntilEndOfTurn ||
      card.copyOfTargetIdPermanent !== undefined ||
      card.permanentCopyPrintedCardData !== undefined
    ) {
      // The source no longer carries a `become_copy`
      // static (the script changed or the source left
      // its `become_copy`-bearing state). Drop the
      // overlay: restore the printed `cardData` from
      // `animatedUntilEndOfTurn` and clear the ledger.
      // Wave 4.8 follow-up 10 lane 77 (#2614
      // follow-up): also drop any leaf-rolled
      // `protectionFrom` — the overlay is gone.
      // Wave 4.8 follow-up 23 lane 70 piece 2a + piece 2b
      // (#2614 follow-up): also drop the permanent-arm
      // ledger (`copyOfTargetIdPermanent`) + the
      // permanent-arm snapshot (`permanentCopyPrintedCardData`)
      // when the static disappears. The printed
      // `cardData` is restored from the snapshot, then
      // both fields are cleared. The `restorePermanentCopyOff
      // Battlefield` consult handles the source-leaves-
      // battlefield case BEFORE this block runs, so a
      // source already restored to printed `cardData`
      // with no snapshot field still lands here iff the
      // `become_copy` static is no longer active.
      if (
        card.copyOfTargetIdPermanent !== undefined ||
        card.permanentCopyPrintedCardData !== undefined
      ) {
        const restored: CardInstance = {
          ...updated,
          cardData:
            card.permanentCopyPrintedCardData ?? card.cardData,
        };
        const cleared = clearPermanentCopyOf(
          clearPermanentCopyPrintedCardData(restored),
        );
        cards.set(cardId, cleared);
        continue;
      }
      leafProtFromById.delete(cardId);
      if (
        card.animatedUntilEndOfTurn &&
        !card.animatedUntilEndOfTurn.setBySpellEffect &&
        !card.animatedUntilEndOfTurn.setByAura
      ) {
        // Static-driven overlay (no `setBySpellEffect`
        // or `setByAura` marker): drop on refresh.
        updated.cardData = card.animatedUntilEndOfTurn.cardData;
        delete updated.animatedUntilEndOfTurn;
        delete updated.copyOfTargetId;
      } else if (
        card.animatedUntilEndOfTurn &&
        card.animatedUntilEndOfTurn.setBySpellEffect
      ) {
        // Wave 4.8 follow-up 8 lane 75a (#2614 follow-up):
        // spell-effect-set overlays (the
        // `CopyUntilEndOfTurn` "create a token that's a
        // copy of [a chosen permanent] until end of turn"
        // shape) are preserved across refreshes — only the
        // EOT cleanup step (`clearUntilEndOfTurnPT`) drops
        // the overlay. The `setBySpellEffect` marker on
        // `animatedUntilEndOfUntil` distinguishes the
        // spell-effect-set overlay from lane 75's
        // static-driven overlay (which drops immediately
        // when no `become_copy` static is active). Without
        // this guard, lane 75a's "until end of turn"
        // semantics would be torn down by every
        // `refreshScriptedStatics` call between cast and
        // EOT. Re-stamp the target's characteristics when
        // the named target is still on the battlefield;
        // restore the printed `cardData` when the target
        // has left (matches the "target leaves" semantics
        // for the until-EOT copy family).
        const target = card.copyOfTargetId
          ? state.cards.get(card.copyOfTargetId)
          : undefined;
        // Wave 4.8 follow-up 10 lane 78 (#2614 follow-up):
        // the target's "in a tracked zone" check (parallel
        // to the lane 78 change in the static-overlay
        // write phase). The overlay applies for any
        // target whose zone is in `state.zones`.
        const targetInTrackedZone = target
          ? target.currentZoneKey !== null &&
            state.zones.has(target.currentZoneKey)
          : false;
        if (target && targetInTrackedZone) {
          const printed = card.animatedUntilEndOfTurn.cardData;
          updated.cardData = {
            ...printed,
            name: target.cardData.name,
            type_line: target.cardData.type_line,
            power: target.cardData.power,
            toughness: target.cardData.toughness,
            colors: target.cardData.colors,
            color_identity: target.cardData.color_identity,
            keywords: target.cardData.keywords,
          };
        } else {
          // Target has left the battlefield; restore
          // the printed `cardData`.
          updated.cardData = card.animatedUntilEndOfTurn.cardData;
        }
      }
    }
    // Wave 4.8 follow-up 10 lane 77 (#2614 follow-up):
    // post-overlay-write phase. After the overlay
    // write has populated `leafProtFromById` (the leaf's
    // rolled `protectionFrom`), union the rolled value
    // with the source's own static-driven protection
    // (`nextProtFrom`) and write the full union onto
    // `updated.protectionFrom`. Multiple `become_copy`
    // overlays stack their protection (the union
    // semantics preserve every leaf's contribution
    // across refreshes). The post-overlay-write phase
    // is the only place where `protectionFrom` is
    // written — the diff at the top of the loop uses
    // the previous ledger's value for change detection;
    // if the diff is a no-op (all `same*` flags true)
    // the card is skipped and `leafProtFromById` is
    // unused.
    const finalLeafProtFrom = leafProtFromById.get(cardId);
    const finalMerged: string[] = [];
    if (nextProtFrom) finalMerged.push(...nextProtFrom);
    if (finalLeafProtFrom) finalMerged.push(...finalLeafProtFrom);
    if (finalMerged.length > 0) {
      const seen = new Set<string>();
      const deduped: string[] = [];
      for (const q of finalMerged) {
        if (seen.has(q)) continue;
        seen.add(q);
        deduped.push(q);
      }
      updated.protectionFrom = deduped;
    } else if ("protectionFrom" in updated) {
      delete updated.protectionFrom;
    }
    // Wave 4.8 follow-up 25 lane 71 piece 1/N (#2614 follow-up):
    // post-overlay-write phase for the per-source ledger.
    // The per-source map is stamped when the source has any
    // `protectionFrom` arms that affect this target. When
    // empty, the field is cleared (the multi-cast semantic
    // reverts to the union). Multiple sources contribute
    // independent entries (the map shape preserves the
    // per-source qualities).
    if (nextProtFromBySource && Object.keys(nextProtFromBySource).length > 0) {
      updated.protectionFromBySource = nextProtFromBySource;
    } else if ("protectionFromBySource" in updated) {
      delete updated.protectionFromBySource;
    }
    // Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
    // final write of the per-instance `deathReplacement`
    // ledger. The diff's `sameDr` branch already skips
    // cards whose ledger hasn't changed; this branch
    // handles the union-and-dedupe semantics for the
    // (rare) case where multiple `static[].death_replacement`
    // arms on the same source contribute overlapping
    // entries. v1 minimum supports one entry per
    // source, so the dedupe is a no-op.
    if (nextDr && nextDr.length > 0) updated.deathReplacement = nextDr;
    else if ("deathReplacement" in updated) delete updated.deathReplacement;
    // Wave 4.8 follow-up 18 lane 112 (#2614 follow-up):
    // final write of the per-instance `grantedTriggers`
    // ledger for the self-grant static arm. The
    // `grantedTriggersBySourceId` map was built earlier
    // in this refresh pass from each source's
    // `statics[].grants.triggers` (CR 603.2 grant
    // semantics — the source grants a triggered ability
    // onto itself). When a source's static has at least
    // one granted trigger, the list is appended to any
    // existing `grantedTriggers` (the Aura-shape lane 65
    // path runs in `refreshAuraBonuses` BEFORE this
    // pass; the field may already carry Aura-shaped
    // grants for the same card, and lane 112 preserves
    // them). v1 the two paths coexist additively
    // (parallel to how `scriptStaticKeywords` unions
    // multiple statics' keyword grants). v1 doesn't
    // delete the field for cards without self-grants
    // — the Aura path's `refreshAuraBonuses` diff is
    // the canonical clear site; lane 112 only adds.
    const nextSelfGrantedTriggers = grantedTriggersBySourceId.get(cardId);
    if (nextSelfGrantedTriggers && nextSelfGrantedTriggers.length > 0) {
      const existing = updated.grantedTriggers ?? [];
      updated.grantedTriggers = [
        ...existing,
        ...nextSelfGrantedTriggers,
      ];
    }
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

/**
 * Wave 4.8 follow-up 13 lane 61b (#2614 follow-up):
 * parsePrintedDeathReplacement — turn a source's printed
 * `cardData.oracle_text` into a structured
 * `ScriptedReplacementEffect` for the lane 61a
 * `replacement_effects` consult. The v1 minimum matches
 * Whip of Erebos's actual oracle ("Whenever a creature
 * you control would die, exile it instead") plus the
 * default-shape variant ("If a creature you control
 * would die, instead exile it"). Other shapes ride
 * follow-up lanes (100 / 101 / 104).
 *
 * Returns `null` when the oracle text doesn't match a
 * recognized v1 shape (the consult ignores the entry —
 * the source's `static[].death_replacement` arm stays
 * inert). `controllerId` is the source's controller (the
 * "you" in the oracle text); the parser preserves it on
 * the entry's `applies_to.controller` field.
 */
export function parsePrintedDeathReplacement(
  oracleText: string | undefined,
  staticText: string,
  controllerId: PlayerId,
): ScriptedReplacementEffect | null {
  const haystack = (oracleText ?? "").toLowerCase();
  // Substring matches against the printed oracle text.
  // The drafter-facing `static[].text` is metadata —
  // the parser consults the printed oracle. The default
  // v1 shape: "would die, instead exile it".
  if (!haystack) return null;
  const matchesExileRedirect =
    /(?:would die|would be put into a graveyard).*(?:instead|exile)\s*it\b/.test(
      haystack,
    ) ||
    /yee die.*instead\s*exile\b/.test(haystack);
  if (!matchesExileRedirect) return null;
  // Detect the controller qualifier — v1 minimum is
  // "creature you control". A bare "creature would die,
  // exile instead" (no "you control") would also match
  // the substring regex but should NOT fire for an
  // opponent-controlled creature; the parser stamps
  // `applies_to.controller: "you"` for the v1 minimum
  // regardless of whether "you control" appears
  // verbatim in the oracle (a permissive match — a
  // Whip of Erebos variant that omits "you" still gets
  // the "you" filter; the consult's runtime filter
  // enforces the actual semantics).
  void staticText;
  void controllerId;
  return {
    text: "If a creature you control would die, instead exile it.",
    event: "would_die",
    applies_to: { type: "creature", controller: "you" },
    redirect: { to: "exile" },
  };
}
