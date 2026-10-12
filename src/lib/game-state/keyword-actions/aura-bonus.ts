/**
 * Static power/toughness bonuses that Auras grant the creature they enchant
 * (CR 303.4, CR 613.4c), e.g. Ethereal Armor: "Enchanted creature gets +1/+1
 * for each enchantment you control" (issue #2453).
 *
 * The summed bonus is stored on `CardInstance.auraPT` and refreshed with the
 * state-based-action pass, like the threshold and tribal anthem statics.
 *
 * Scripted Auras (issue #2568) ride the same refresh path: their
 * `aura.static` is read in addition to the engine's oracle-text parser, so
 * the enchanted permanent's `auraPT` / `auraKeywords` /
 * `auraRestrictAttack` / `auraRestrictBlock` come from both sources
 * simultaneously.
 */
import type { CardInstance, CardInstanceId, GameState, PlayerId } from "../types";
import { getCardScript } from "../card-scripts/registry";
import { buildAuraCopyChainSnapshot } from "./copy-chain";

export interface AuraPT {
  power: number;
  toughness: number;
  /** "for each enchantment you control": multiply by that count. */
  perEnchantment: boolean;
}

const AURA_PT =
  /\b[Ee]nchanted creature gets ([+-]\d+)\/([+-]\d+)( for each enchantment you control)?/g;

/** Every "Enchanted creature gets +N/+N [for each enchantment you control]" clause. */
export function parseAuraPT(oracleText: string): AuraPT[] {
  const out: AuraPT[] = [];
  for (const m of oracleText.matchAll(AURA_PT)) {
    out.push({
      power: parseInt(m[1], 10),
      toughness: parseInt(m[2], 10),
      perEnchantment: Boolean(m[3]),
    });
  }
  return out;
}

/**
 * Keywords an Aura grants: "Enchanted creature ... has first strike"
 * (Ethereal Armor, issue #2464). Only evergreen keywords are kept.
 */
const GRANTABLE = [
  "first strike",
  "double strike",
  "flying",
  "vigilance",
  "trample",
  "lifelink",
  "deathtouch",
  "haste",
  "menace",
  "reach",
  "hexproof",
  "indestructible",
];
const AURA_HAS = /\b[Ee]nchanted creature (?:gets [^.]*? and )?has ([^.]+)\./g;

export function parseAuraKeywords(oracleText: string): string[] {
  const out: string[] = [];
  for (const m of oracleText.matchAll(AURA_HAS)) {
    for (const part of m[1].toLowerCase().split(/,\s*(?:and\s+)?|\s+and\s+/)) {
      const kw = part.trim();
      if (GRANTABLE.includes(kw) && !out.includes(kw)) out.push(kw);
    }
  }
  return out;
}

function isEnchantment(card: CardInstance): boolean {
  return /\bEnchantment\b/.test(card.cardData.type_line ?? "");
}

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
 * Recompute `auraPT` for every card from the Auras attached to it. "You" in
 * the Aura's text is the Aura's controller. Returns the same state object
 * when nothing changed.
 *
 * Scripted Auras (issue #2568) contribute via their `aura.static`; oracle-
 * text Auras contribute via `parseAuraPT` / `parseAuraKeywords`. The
 * Pacifism-style `restrictAttack` / `restrictBlock` flags are surfaced as
 * `auraRestrictAttack` / `auraRestrictBlock` so `canAttack` / `canBlock`
 * can refuse them.
 */
export function refreshAuraBonuses(state: GameState): GameState {
  const onField = battlefieldCards(state);
  const onFieldIds = new Set(onField.map((c) => c.id));
  // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
  // build a snapshot of every enchanted card's
  // "effective copy target" (the leaf of the chosen
  // target's copy chain) BEFORE the overlay write
  // phase runs. An Aura with a `become_copy` arm
  // whose chosen target has its own `become_copy`
  // static overlays the LEAF's printed `cardData`
  // in a single pass; a cyclic chain is broken by
  // dropping the overlay on every cycle member.
  // The cycle guard consults the printed `cardData`
  // of each card it walks, so the snapshot is
  // independent of any in-flight overlay from a
  // prior pass.
  const auraCopyChain = buildAuraCopyChainSnapshot(state);
  const bonus = new Map<string, { power: number; toughness: number }>();
  const keywords = new Map<string, string[]>();
  const restrictAttack = new Map<string, string[]>();
  const restrictBlock = new Map<string, string[]>();
  // #2594 #9: "doesn't untap during your untap step" — the engine
  // surfaces these to the enchanted card as `auraRestrictUntap` so
  // `processUntapStep` can skip the untap (CR 303.4d / 502.2).
  const restrictUntap = new Map<string, string[]>();
  // #2614: "can't be blocked by more than one creature" (CR 509.1b).
  const maxBlockers = new Map<string, number>();
  // Wave 4.8 follow-up 6 lane 76 (#2614 follow-up): the
  // per-target protection-from ledger stamped by Auras
  // with a `protectionFrom` arm ("Enchanted creature has
  // protection from red"). The per-instance `protectionFrom`
  // field is data-driven (read by `hasProtectionFrom` via
  // the existing `perInstance.some(...)` loop) so multi-
  // quality protection is automatic. The map is keyed by
  // the enchanted card id; the value is the union of
  // qualities granted by every attached Aura with a
  // `protectionFrom` arm. The diff at the bottom of this
  // function compares the current and next lists and
  // stamps the diff on the card's `protectionFrom` field
  // (battlefield-zone-only, dropped when no Aura with the
  // arm is attached).
  const auraProtFromByTarget = new Map<string, string[]>();
  // Wave 4.8 follow-up 10 lane 77 (#2614 follow-up):
  // the rolled leaf `protectionFrom` for enchanted
  // cards whose attached Aura has a `become_copy` arm.
  // Populated when the Aura overlay write phase rolls
  // the chosen target's leaf's `protectionFrom` onto
  // the enchanted card; consumed at the bottom of the
  // refresh pass when stamping the `protectionFrom`
  // field on the enchanted card's updated state (union
  // semantics with the enchanted card's own
  // Aura-driven `protectionFrom`). Cleared when the
  // overlay is dropped (cycle, target left, Aura no
  // longer attached).
  const leafProtFromById = new Map<string, string[]>();
  // Wave 4.8 lane 54 (#2614 follow-up): cards with at
  // least one attached Aura whose static has
  // `removesAllAbilities: true`. A Set keyed by target id;
  // the boolean is `card.losesAbilities === true` at the
  // end of the refresh pass.
  const losesAbilities = new Set<string>();
  // Wave 4.8 follow-up 3 lane 65 (#2614 follow-up): the
  // per-target list of granted triggers stamped onto each
  // enchanted card. Keyed by target id. Each entry is the
  // union of `static.grants.triggers` from every attached
  // Aura that has a `grants.triggers` arm (v1 supports one
  // per Aura; multiple Auras append). The list is cleared
  // when no Aura with the `grants` arm is attached (the
  // diff at the bottom of this function compares the
  // current and next lists and stamps the diff on the
  // card's `grantedTriggers` field).
  const grantedTriggersByTarget = new Map<
    string,
    Array<{
      event: "dies";
      effects: Array<{ op: string; [k: string]: unknown }>;
      from: CardInstanceId;
      sourceControllerId: PlayerId;
    }>
  >();
  // Wave 4.8 follow-up 8 lane 75d (#2614 follow-up): the
  // per-enchanted-card copy-target ledger for Auras with
  // a `become_copy` arm. The Aura's static carries
  // `become_copy: { target: CardInstanceId, until:
  // "end_of_turn" }`; the engine writes the chosen
  // target's printed characteristics onto the
  // ENCHANTED CARD's `cardData` via the lane 75
  // `animatedUntilEndOfTurn` infrastructure. Keyed by
  // the ENCHANTED card id (NOT the Aura id — the lane 75
  // `copyOfTargetBySourceId` keys by the source, but
  // here the source IS the Aura and the overlay is
  // applied to the enchanted card; the enchanted card's
  // id is the right key for the per-enchanted-card
  // overlay collection map). v1 single chosen target on
  // the battlefield; the chosen target's `state.cards`
  // lookup is validated at write-phase time.
  const auraCopyOfTargetByEnchantedCard = new Map<
    string,
    { kind: "id"; targetId: string; fromAura: CardInstanceId }
  >();

  for (const aura of onField) {
    const target = aura.attachedToId;
    if (!target || !onFieldIds.has(target)) continue;
    const text = aura.cardData.oracle_text ?? "";
    const granted = parseAuraKeywords(text);
    if (granted.length > 0) {
      const kws = keywords.get(target) ?? [];
      for (const k of granted) if (!kws.includes(k)) kws.push(k);
      keywords.set(target, kws);
    }
    const clauses = parseAuraPT(text);
    if (clauses.length > 0) {
      const enchantments = onField.filter(
        (c) => c.controllerId === aura.controllerId && isEnchantment(c),
      ).length;
      const prev = bonus.get(target) ?? { power: 0, toughness: 0 };
      for (const c of clauses) {
        const n = c.perEnchantment ? enchantments : 1;
        prev.power += c.power * n;
        prev.toughness += c.toughness * n;
      }
      bonus.set(target, prev);
    }
    // Scripted aura static (issue #2568): read the same path as
    // `refreshEquipmentBonuses` — get the script, then layer the static
    // into the same per-target maps. The card's type_line still drives
    // the oracle-text parser above, so an aura whose oracle also matches
    // contributes from both; they agree in practice.
    const script = getCardScript(aura.cardData.name);
    const scriptedStatic = script?.aura?.static;
    if (scriptedStatic) {
      if (
        scriptedStatic.power !== undefined ||
        scriptedStatic.toughness !== undefined
      ) {
        const prev = bonus.get(target) ?? { power: 0, toughness: 0 };
        prev.power += scriptedStatic.power ?? 0;
        prev.toughness += scriptedStatic.toughness ?? 0;
        bonus.set(target, prev);
      }
      if (scriptedStatic.keywords && scriptedStatic.keywords.length > 0) {
        const kws = keywords.get(target) ?? [];
        for (const k of scriptedStatic.keywords) {
          const norm = k.toLowerCase();
          if (!kws.includes(norm)) kws.push(norm);
        }
        keywords.set(target, kws);
      }
      if (scriptedStatic.restrictAttack) {
        const list = restrictAttack.get(target) ?? [];
        if (!list.includes(aura.cardData.name)) list.push(aura.cardData.name);
        restrictAttack.set(target, list);
      }
      if (scriptedStatic.restrictBlock) {
        const list = restrictBlock.get(target) ?? [];
        if (!list.includes(aura.cardData.name)) list.push(aura.cardData.name);
        restrictBlock.set(target, list);
      }
      // #2594 #9: surface the "doesn't untap" restriction. Same shape
      // as restrictAttack / restrictBlock — a list of aura names so
      // the consumer can show "Starlight Snare prevents untapping."
      if (scriptedStatic.restrictUntap) {
        const list = restrictUntap.get(target) ?? [];
        if (!list.includes(aura.cardData.name)) list.push(aura.cardData.name);
        restrictUntap.set(target, list);
      }
      if (scriptedStatic.maxBlockers !== undefined) {
        const prev = maxBlockers.get(target);
        maxBlockers.set(
          target,
          prev === undefined
            ? scriptedStatic.maxBlockers
            : Math.min(prev, scriptedStatic.maxBlockers),
        );
      }
      // Wave 4.8 lane 54 (#2614 follow-up): Witness
      // Protection's "loses all other abilities" arm.
      // The enchanted card's `script.activated` abilities
      // are gated by `losesAbilities` (the engine side
      // mirrors the lane 50 Spyglass chosen-name gate).
      // Multiple Auras with `removesAllAbilities: true`
      // are redundant; `losesAbilities` is a single
      // boolean. The flag is stamped for the duration
      // of any such Aura; cleared when all such Auras
      // leave the battlefield.
      if (scriptedStatic.removesAllAbilities === true) {
        losesAbilities.add(target);
      }
      // Wave 4.8 follow-up 3 lane 65 (#2614 follow-up):
      // a granted-trigger Aura copies its `grants.triggers`
      // onto the enchanted card. The per-target list is
      // built up across every attached Aura (multiple
      // Auras with `grants` arms append; the
      // `refreshAuraBonuses` diff path writes the union
      // onto `card.grantedTriggers` and clears it when no
      // Aura with the `grants` arm is attached). The
      // trigger fires from the enchanted card (the
      // subject is the dying creature, not the Aura);
      // the effect's `who: "you"` resolves to the
      // enchanted card's controller (CR 603.2 / 603.10a),
      // NOT the Aura's original controller — the source
      // field on the granted trigger is for diagnostics.
      if (
        scriptedStatic.grants?.triggers &&
        scriptedStatic.grants.triggers.length > 0
      ) {
        const list = grantedTriggersByTarget.get(target) ?? [];
        for (const t of scriptedStatic.grants.triggers) {
          list.push({
            event: t.event,
            // The effect op is unknown to TS here, but the
            // trigger fire path applies the effects via
            // the same interpreter that processes scripted
            // triggers; the list shape matches
            // `ScriptedTrigger.effects`.
            effects: t.effects as Array<{
              op: string;
              [k: string]: unknown;
            }>,
            from: aura.id,
            sourceControllerId: aura.controllerId,
          });
        }
        grantedTriggersByTarget.set(target, list);
      }
      // Wave 4.8 follow-up 6 lane 76 (#2614 follow-up):
      // an Aura with `protectionFrom: ["red"]` grants
      // protection from the named quality to the
      // enchanted creature. The per-target list is
      // built up across every attached Aura (multiple
      // Auras append; the `refreshAuraBonuses` diff
      // path writes the union onto
      // `card.protectionFrom` and clears it when no
      // Aura with the `protectionFrom` arm is attached
      // — parallel to the lane 65 grantedTriggers
      // pattern). The same `hasProtectionFrom` check
      // reads the field (no new engine code is needed
      // for the per-instance check; the existing
      // `perInstance.some(...)` loop in
      // `evergreen-keywords.ts` covers multi-quality
      // protection for free).
      if (
        scriptedStatic.protectionFrom &&
        scriptedStatic.protectionFrom.length > 0
      ) {
        const list = auraProtFromByTarget.get(target) ?? [];
        for (const q of scriptedStatic.protectionFrom) {
          if (!list.includes(q)) list.push(q);
        }
        auraProtFromByTarget.set(target, list);
      }
      // Wave 4.8 follow-up 8 lane 75d (#2614 follow-up):
      // an Aura with a `become_copy: { target,
      // until: "end_of_turn" }` arm writes the chosen
      // target's printed characteristics onto the
      // ENCHANTED CARD's `cardData` via the lane 75
      // `animatedUntilEndOfTurn` infrastructure. v1
      // single chosen target on the battlefield; the
      // target MUST be on the battlefield at write-phase
      // time (the engine validates `state.cards.has`)
      // — otherwise the overlay is dropped and the
      // enchanted card's printed `cardData` is restored.
      // The "last write wins" semantics apply: when
      // multiple Auras carry a `become_copy` arm onto
      // the same enchanted card, the last Aura in the
      // iteration order wins (matches lane 65's
      // `grantedTriggers` collect-order semantics; a
      // card is unlikely to carry more than one such
      // Aura in v1, but the deterministic-overwrite is
      // the safe default).
      if (scriptedStatic.become_copy !== undefined) {
        if ("target" in scriptedStatic.become_copy) {
          auraCopyOfTargetByEnchantedCard.set(target, {
            kind: "id",
            targetId: scriptedStatic.become_copy.target,
            fromAura: aura.id,
          });
        }
        // The lane 75d v1 minimum only supports the
        // `target: CardInstanceId` arm (no named-card
        // / exceptions / multi-target on Auras). The
        // other arms are follow-up lanes.
      }
    }
  }

  let cards: GameState["cards"] | null = null;
  const sameStringList = (
    a: readonly string[] | undefined,
    b: readonly string[],
  ) => (a?.length ?? 0) === b.length && (a ?? []).every((v, i) => v === b[i]);

  for (const [cardId, card] of state.cards) {
    const next = bonus.get(cardId);
    const was = card.auraPT;
    const nextKw = keywords.get(cardId) ?? [];
    const wasKw = card.auraKeywords ?? [];
    const nextRA = restrictAttack.get(cardId) ?? [];
    const wasRA = card.auraRestrictAttack ?? [];
    const nextRB = restrictBlock.get(cardId) ?? [];
    const wasRB = card.auraRestrictBlock ?? [];
    const nextRU = restrictUntap.get(cardId) ?? [];
    const wasRU = card.auraRestrictUntap ?? [];
    const nextMB = maxBlockers.get(cardId);
    // Wave 4.8 lane 54: `losesAbilities` flag diff. A
    // Set is overkill — `losesAbilities` is a single
    // boolean — so compare `card.losesAbilities` against
    // `losesAbilities.has(cardId)`. The `continue` short
    // circuits when nothing changed for this card.
    const nextLosesAbilities = losesAbilities.has(cardId);
    // Wave 4.8 follow-up 3 lane 65 (#2614 follow-up):
    // `grantedTriggers` list diff. Compare the per-target
    // granted list (built up across every attached Aura
    // with `grants.triggers`) against the card's current
    // `grantedTriggers` field. The lists are compared
    // structurally (event + effects + from) — when the
    // lists differ, the next list is stamped; when no
    // Aura has the `grants` arm, the field is cleared
    // (the lane 52 chosen-eviction-at-tombstone pattern:
    // the field is battlefield-zone-only, dropped when
    // the source leaves the battlefield).
    const nextGrantedTriggers = grantedTriggersByTarget.get(cardId) ?? [];
    const wasGrantedTriggers = card.grantedTriggers ?? [];
    const sameGrantedTriggers =
      nextGrantedTriggers.length === wasGrantedTriggers.length &&
      nextGrantedTriggers.every(
        (g, i) =>
          wasGrantedTriggers[i] &&
          wasGrantedTriggers[i].event === g.event &&
          wasGrantedTriggers[i].from === g.from &&
          wasGrantedTriggers[i].sourceControllerId === g.sourceControllerId &&
          JSON.stringify(wasGrantedTriggers[i].effects) ===
            JSON.stringify(g.effects),
      );
    // Wave 4.8 follow-up 6 lane 76 (#2614 follow-up):
    // the per-target protection-from ledger. Same
    // shape as the lane 71 static arm: a sorted,
    // deduped list of qualities stamped onto the
    // enchanted card via the existing
    // `hasProtectionFrom` check in
    // `evergreen-keywords.ts`. The diff compares the
    // sorted arrays element-by-element; the field is
    // dropped when no Aura with the `protectionFrom`
    // arm is attached.
    const nextProtFrom = (auraProtFromByTarget.get(cardId) ?? []).sort();
    const wasProtFrom = (card.protectionFrom ?? []).sort();
    const sameProtFrom =
      nextProtFrom.length === wasProtFrom.length &&
      nextProtFrom.every((q, i) => q === wasProtFrom[i]);
    // Wave 4.8 follow-up 8 lane 75d (#2614 follow-up):
    // the per-enchanted-card copy-target ledger for
    // Auras with a `become_copy` arm. The next-value
    // is the chosen target's id (when an Aura with a
    // matching `become_copy` is attached to this
    // enchanted card). The was-value is the
    // enchanted card's existing `copyOfTargetId`
    // ledger (set by an earlier refresh); the diff
    // decides whether to apply, drop, or hold the
    // overlay. When the next-value is undefined (no
    // Aura with `become_copy` is attached to this
    // card), the diff drops any in-flight overlay.
    const nextAuraCopyOfTargetId =
      auraCopyOfTargetByEnchantedCard.get(cardId)?.targetId;
    const sameAuraCopyOfTarget =
      nextAuraCopyOfTargetId === card.copyOfTargetId;
    if (
      (was?.power ?? 0) === (next?.power ?? 0) &&
      (was?.toughness ?? 0) === (next?.toughness ?? 0) &&
      nextKw.join("|") === wasKw.join("|") &&
      sameStringList(wasRA, nextRA) &&
      sameStringList(wasRB, nextRB) &&
      sameStringList(wasRU, nextRU) &&
      card.auraMaxBlockers === nextMB &&
      Boolean(card.losesAbilities) === nextLosesAbilities &&
      sameGrantedTriggers &&
      sameProtFrom &&
      sameAuraCopyOfTarget
    ) {
      continue;
    }
    cards ??= new Map(state.cards);
    const updated = { ...card };
    if (next && (next.power || next.toughness)) updated.auraPT = next;
    else delete updated.auraPT;
    if (nextKw.length > 0) updated.auraKeywords = nextKw;
    else delete updated.auraKeywords;
    if (nextRA.length > 0) updated.auraRestrictAttack = nextRA;
    else delete updated.auraRestrictAttack;
    if (nextRB.length > 0) updated.auraRestrictBlock = nextRB;
    else delete updated.auraRestrictBlock;
    if (nextRU.length > 0) updated.auraRestrictUntap = nextRU;
    else delete updated.auraRestrictUntap;
    if (nextMB !== undefined) updated.auraMaxBlockers = nextMB;
    else delete updated.auraMaxBlockers;
    if (nextLosesAbilities) updated.losesAbilities = true;
    else delete updated.losesAbilities;
    // Wave 4.8 follow-up 3 lane 65: write the
    // granted-triggers list when at least one Aura is
    // attached; clear the field when no Aura is attached
    // (the field is per-instance + battlefield-zone-only,
    // dropped when the source leaves the battlefield —
    // parallel to the lane 52 add_creature_type pattern).
    if (nextGrantedTriggers.length > 0) {
      updated.grantedTriggers = nextGrantedTriggers;
    } else {
      delete updated.grantedTriggers;
    }
    // Wave 4.8 follow-up 6 lane 76 (#2614 follow-up):
    // the per-target protection-from ledger. Same
    // shape as the lane 71 static arm: a sorted,
    // deduped list of qualities stamped onto the
    // enchanted card via the existing
    // `hasProtectionFrom` check in
    // `evergreen-keywords.ts`. The diff compares the
    // sorted arrays element-by-element; the field is
    // dropped when no Aura with the `protectionFrom`
    // arm is attached.
    //
    // Wave 4.8 follow-up 10 lane 77 (#2614 follow-up):
    // the WRITE of `updated.protectionFrom` is moved
    // AFTER the overlay write phase (the rolled leaf
    // `protectionFrom` is populated by the overlay
    // write, so the bottom write needs to run AFTER
    // that). The diff at the top of the loop reads
    // the cached `wasProtFrom` for change detection;
    // the post-overlay-write block re-stamps
    // `updated.protectionFrom` with the full union
    // before `cards.set`.
    // Wave 4.8 follow-up 8 lane 75d (#2614 follow-up):
    // write the copy-target overlay when at least one
    // Aura with a `become_copy` arm is attached to
    // this enchanted card (the `refreshScriptedStatics`
    // path on the Aura's own `cardData` is NOT used
    // here; the overlay is applied to the ENCHANTED
    // CARD via the same lane 75
    // `animatedUntilEndOfTurn` infrastructure). The
    // overlay:
    // - Snapshots the enchanted card's printed
    //   `cardData` under `animatedUntilEndOfTurn`.
    // - Overlays the chosen target's printed
    //   characteristics (name, type_line, P/T,
    //   colors, color_identity, keywords — CR 707.2
    //   "all characteristics copied") onto the
    //   enchanted card's live `cardData`.
    // - Stamps `copyOfTargetId` with the chosen
    //   target's `CardInstanceId` (a stable ledger
    //   tag for the change-detection diff).
    //
    // The overlay is dropped when no Aura with the
    // `become_copy` arm is attached: the enchanted
    // card's printed `cardData` is restored from
    // `animatedUntilEndOfTurn` and the ledger is
    // cleared. The lane 75 / 75b / 75c
    // `refreshScriptedStatics` diff's "drop" branch
    // is NOT used here because lane 75d's overlay is
    // owned by the Aura attachment, not by the lane 75
    // static path — this refresh is the canonical
    // drop site.
    if (nextAuraCopyOfTargetId !== undefined) {
      // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
      // cycle guard — drop the overlay for any enchanted
      // card whose chosen target's copy chain forms a
      // cycle. The cycle member is treated as if it
      // had no `become_copy` arm: the enchanted card's
      // printed `cardData` is restored and the copy
      // ledger is cleared. The snapshot's `cycleIds`
      // set covers every id in any cycle, so a
      // `cycleIds.has(cardId)` check catches cycles
      // whose leaves are intermediate targets the
      // enchanted card is not directly attached to.
      if (auraCopyChain.cycleIds.has(cardId)) {
        if (updated.animatedUntilEndOfTurn) {
          updated.cardData = updated.animatedUntilEndOfTurn.cardData;
          delete updated.animatedUntilEndOfTurn;
          delete updated.copyOfTargetId;
        } else {
          // No prior overlay — the Aura-driven overlay
          // is suppressed for this pass. The copy
          // ledger is cleared.
          delete updated.copyOfTargetId;
        }
        // Wave 4.8 follow-up 10 lane 77 (#2614
        // follow-up): drop any leaf-rolled
        // `protectionFrom` — the cycle case
        // suppresses the overlay entirely.
        leafProtFromById.delete(cardId);
        cards.set(cardId, updated);
        continue;
      }
      const chosenTarget = state.cards.get(nextAuraCopyOfTargetId);
      const chosenTargetOnField =
        chosenTarget &&
        chosenTarget.currentZoneKey?.endsWith("-battlefield");
      if (chosenTarget && chosenTargetOnField) {
        const printed =
          updated.animatedUntilEndOfTurn?.cardData ?? updated.cardData;
        // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
        // mark the overlay as Aura-driven so
        // `refreshScriptedStatics` doesn't drop it on a
        // subsequent refresh between Aura refreshes. The
        // `setByAura` marker is parallel to lane 75a's
        // `setBySpellEffect` marker — both are
        // preserved across static refreshes; only the
        // Aura refresh (or EOT cleanup) drops them.
        updated.animatedUntilEndOfTurn = {
          cardData: printed,
          setByAura: true,
        };
        // Wave 4.8 follow-up 9 lane 75e (#2614 follow-up):
        // consult the snapshot's leaf `cardData` when
        // available (a nested-copy chain — the chosen
        // target has its own `become_copy` static — is
        // resolved in one pass: the enchanted card
        // overlays the leaf's printed characteristics);
        // fall back to the immediate chosen target's
        // printed `cardData` when the chain has no
        // further extension (the chosen target IS the
        // leaf, or the chain terminated because the
        // leaf has no `become_copy` arm).
        const leafFromSnapshot =
          auraCopyChain.leafCardDataByEnchantedCard.get(cardId);
        const targetPrinted =
          leafFromSnapshot ??
          (chosenTarget.animatedUntilEndOfTurn?.cardData ??
            chosenTarget.cardData);
        updated.cardData = {
          ...printed,
          name: targetPrinted.name,
          type_line: targetPrinted.type_line,
          power: targetPrinted.power,
          toughness: targetPrinted.toughness,
          colors: targetPrinted.colors,
          color_identity: targetPrinted.color_identity,
          keywords: targetPrinted.keywords,
        };
        updated.copyOfTargetId = nextAuraCopyOfTargetId;
        // Wave 4.8 follow-up 10 lane 77 (#2614
        // follow-up): roll the chosen target's leaf's
        // `protectionFrom` onto the enchanted card.
        // The snapshot's
        // `leafPerInstanceByEnchantedCard` carries
        // the leaf's per-instance fields (populated
        // by the previous pass's
        // `refreshScriptedStatics` write on the leaf).
        // Union semantics at the bottom of the pass.
        const leafPerInstance =
          auraCopyChain.leafPerInstanceByEnchantedCard.get(cardId);
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
      } else if (updated.animatedUntilEndOfTurn) {
        // Chosen target has left the battlefield — restore
        // the enchanted card's printed `cardData`.
        updated.cardData = updated.animatedUntilEndOfTurn.cardData;
        delete updated.animatedUntilEndOfTurn;
        // Wave 4.8 follow-up 10 lane 77: drop any
        // leaf-rolled `protectionFrom` — the chosen
        // target is gone.
        leafProtFromById.delete(cardId);
        delete updated.copyOfTargetId;
      }
    } else if (updated.animatedUntilEndOfTurn) {
      // No Aura with `become_copy` is attached to this
      // enchanted card; drop any in-flight overlay (the
      // source Aura left the battlefield, or the Aura
      // changed to a static without the `become_copy`
      // arm).
      updated.cardData = updated.animatedUntilEndOfTurn.cardData;
      delete updated.animatedUntilEndOfTurn;
      delete updated.copyOfTargetId;
      // Wave 4.8 follow-up 10 lane 77: drop any
      // leaf-rolled `protectionFrom` — the Aura is
      // gone, the overlay is gone, the rolled
      // protection no longer applies.
      leafProtFromById.delete(cardId);
    }
    // Wave 4.8 follow-up 10 lane 77 (#2614 follow-up):
    // post-overlay-write phase. After the overlay
    // write has populated `leafProtFromById`, union
    // the rolled value with the enchanted card's own
    // Aura-driven protection (`nextProtFrom`) and write
    // the full union onto `updated.protectionFrom`.
    // Multiple Auras stack their protection; the union
    // semantics preserve every Aura's contribution
    // across refreshes.
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
