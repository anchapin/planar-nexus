/**
 * Static abilities from card scripts (issue #2496): "Creatures you control get
 * +1/+1", "Other Dinosaurs you control get +1/+1", "Creatures you control have
 * haste". Continuous effects from static abilities (CR 611.3) apply in layer 6
 * (keywords) and layer 7c (P/T). Like the tribal and Aura statics, the summed
 * result is kept on the card and refreshed with the state-based-action pass,
 * because `getEffectivePower` and `hasKeyword` only see the card.
 */
import type { CardInstance, GameState } from "../types";
import { getCardScript, getCardDataByName } from "../card-scripts/registry";
import type { RuleStatic, ScriptedStatic } from "../card-scripts/schema";
import type { ScryfallCard } from "../types/card-data";
import { restoreAnimatedOffBattlefield } from "../pt-until-end-of-turn";
import { returnEarthbentLands } from "./earthbend";
import { getCardColors } from "../evergreen-keywords";
import { buildStaticCopyChainSnapshot } from "./copy-chain";

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
  const state = restoreAnimatedOffBattlefield(returnEarthbentLands(input));
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
    const statics = getCardScript(card.cardData.name)?.statics;
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
    | { kind: "id"; targetId: string }
    | { kind: "name"; name: string }
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
            });
          } else {
            copyOfTargetBySourceId.set(card.id, {
              kind: "name",
              name: stat.become_copy.named_card.name,
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
  }

  let cards: GameState["cards"] | null = null;
  for (const [cardId, card] of state.cards) {
    const nextPT = pt.get(cardId);
    const nextKw = kws.get(cardId) ?? [];
    const nextAdds = typeAdditions.get(cardId);
    const nextColors = colorAdditions.get(cardId);
    const nextProtFrom = protFromById.get(cardId);
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
    // When the card has a `setByAura` overlay AND no
    // static-driven `become_copy` arm, the diff is
    // considered a no-op: the Aura refresh will
    // re-stamp the overlay on its next pass. The
    // `cardData` and `animatedUntilEndOfTurn` are
    // preserved as-is.
    const auraOverlayActive =
      card.animatedUntilEndOfTurn?.setByAura === true &&
      nextCopyOfTargetId === undefined;
    if (
      samePT &&
      sameKw &&
      sameAdds &&
      sameColors &&
      sameProtFrom &&
      sameCopyOfTarget
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
        const targetOnField = target
          ? target.currentZoneKey?.endsWith("-battlefield")
          : false;
        if (target && targetOnField) {
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
      } else {
        // Source has never had a copy overlay; no-op.
        // (The `else if` branch below would also
        // fire on a `become_copy` static going
        // away — that's the expected behavior.)
        delete updated.copyOfTargetId;
        // Wave 4.8 follow-up 10 lane 77: no prior
        // overlay → no rolled protection to clear.
      }
    } else if (card.copyOfTargetId !== undefined || card.animatedUntilEndOfTurn) {
      // The source no longer carries a `become_copy`
      // static (the script changed or the source left
      // its `become_copy`-bearing state). Drop the
      // overlay: restore the printed `cardData` from
      // `animatedUntilEndOfTurn` and clear the ledger.
      // Wave 4.8 follow-up 10 lane 77 (#2614
      // follow-up): also drop any leaf-rolled
      // `protectionFrom` — the overlay is gone.
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
        const targetOnField = target
          ? target.currentZoneKey?.endsWith("-battlefield")
          : false;
        if (target && targetOnField) {
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
