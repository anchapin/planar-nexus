/**
 * Wave 4.8 follow-up 9 lane 75e (#2614 follow-up): the
 * nested-copy cycle guard for the until-EOT copy family
 * (StaticSchema lane 75 / 75b / 75c + AuraStaticSchema lane
 * 75d). The lane 75 v1 explicitly assumes the named
 * target's printed `cardData` is the source-of-truth for
 * the overlay. A nested copy (a target that itself has a
 * `become_copy` static) would loop or produce inconsistent
 * results: the refresh pass would re-read the in-flight
 * overlay on the target, not its printed `cardData`, so
 * the source's overlay would be the target's overlaid
 * `cardData` (which is whatever the target's
 * `become_copy` is currently showing).
 *
 * The cycle guard resolves every card's "effective copy
 * target" (the leaf of its copy chain) at the top of the
 * refresh pass — BEFORE any overlay writes — and exposes
 * the leaf's printed `cardData` as the source-of-truth
 * for the overlay. The overlay effectively chains all the
 * way to the leaf in one pass: a source whose `become_copy`
 * points at a target whose `become_copy` points at a third
 * card overlays the third card's printed `cardData` in a
 * single refresh.
 *
 * Cycle detection: a card whose copy chain includes itself
 * is treated as if it had no `become_copy` arm. The
 * helper records the cycle id; the write phase checks
 * `cycleIds.has(cardId)` and drops the overlay.
 *
 * The helper consults the printed `cardData` of each
 * card it walks (the `card.animatedUntilEndOfTurn?.cardData
 * ?? card.cardData` pattern from the overlay write phase).
 * v1 only follows the `id` form of the ledger; the `name`
 * form (lane 75b) terminates immediately at the named
 * card's registry `cardData` because the named card is
 * not on the battlefield and therefore has no `become_copy`
 * of its own (a named card's `cardData` is the registry
 * value, not a live in-flight overlay).
 *
 * Snapshot shape:
 *   {
 *     leafBySourceId: Map<string, CardInstanceId | string>,
 *     leafCardDataBySourceId: Map<string, ScryfallCard>,
 *     cycleIds: Set<CardInstanceId>,
 *   }
 *
 * The snapshot is consumed by the write phase at the
 * bottom of `refreshScriptedStatics` and
 * `refreshAuraBonuses`. The write phase checks
 * `cycleIds.has(cardId)` first (cycle → drop), then reads
 * `leafCardDataBySourceId.get(cardId)` to obtain the
 * overlay source. The `leafBySourceId` map is for
 * diagnostics + change-detection diff parity.
 */
import type { CardInstance, GameState } from "../types";
import { getCardScript, getCardDataByName } from "../card-scripts/registry";
import type { CardScript } from "../card-scripts/schema";
import type { ScryfallCard } from "../types/card-data";

/**
 * A single card's "effective copy target" snapshot.
 * The cycle guard resolves the leaf of the card's copy
 * chain at the top of the refresh pass so the overlay
 * write phase consults the leaf's printed `cardData`
 * rather than the in-flight overlay on intermediate
 * targets.
 */
export interface CopyChainSnapshot {
  /**
   * For each card that participates in a copy chain,
   * the leaf of the chain (a `CardInstanceId` for the
   * `id` form, a `name:<name>` string for the `name`
   * form). Undefined for cards without a `become_copy`
   * arm.
   */
  leafBySourceId: Map<string, string>;
  /**
   * For each card that participates in a copy chain,
   * the leaf's printed `cardData` — the value the
   * overlay write phase copies onto the source's
   * `cardData` (after merging with the source's
   * printed `cardData` for the static-driven case).
   */
  leafCardDataBySourceId: Map<string, ScryfallCard>;
  /**
   * The set of card ids whose copy chain forms a cycle
   * (a card whose copy chain includes itself). Cards
   * in this set are treated by the write phase as if
   * they had no `become_copy` arm — the overlay is
   * dropped and the source's printed `cardData` is
   * restored.
   */
  cycleIds: Set<string>;
}

/**
 * Find the `become_copy` arm on a card's script. The arm
 * may be on a `StaticSchema` static (lane 75 / 75b / 75c)
 * or on an `AuraStaticSchema` aura static (lane 75d). For
 * the cycle guard's chain walk, the two shapes are
 * equivalent: the card is treated as "copying" the
 * target named by the arm.
 */
function findBecomeCopyArm(script: CardScript | undefined):
  | { source: "static"; target: string; named: false }
  | { source: "static"; target: string; named: true }
  | { source: "aura"; target: string; named: false }
  | undefined {
  if (!script) return undefined;
  const stat = script.statics?.find((s) => s.become_copy !== undefined);
  if (stat?.become_copy) {
    if ("named_card" in stat.become_copy) {
      return {
        source: "static",
        target: stat.become_copy.named_card.name,
        named: true,
      };
    }
    return {
      source: "static",
      target: stat.become_copy.target,
      named: false,
    };
  }
  const auraBecomeCopy = script.aura?.static?.become_copy;
  if (auraBecomeCopy && "target" in auraBecomeCopy) {
    return {
      source: "aura",
      target: auraBecomeCopy.target,
      named: false,
    };
  }
  return undefined;
}

/**
 * Walk a card's `become_copy` chain to its leaf. Returns
 * `{ leaf, cycle }`:
 *   - `leaf`: the leaf of the copy chain (a `CardInstanceId`
 *     for the `id` form, a `name:<name>` string for the
 *     `name` form, or the input `cardId` when the card
 *     has no `become_copy` arm).
 *   - `cycle`: true when the card's copy chain forms a
 *     cycle (a card whose chain includes itself).
 *
 * The helper walks the chain by reading the SCRIPT'S
 * `become_copy` arm on each card (rather than the prior
 * `copyOfTargetId` ledger). The script is the
 * source-of-truth for "what does this card copy?"; the
 * ledger is a consequence of the static, written by the
 * overlay write phase. On the FIRST refresh pass the
 * ledger is unset for a card whose overlay is being
 * established, so following the script — not the ledger
 * — is the only way to resolve the chain correctly in
 * one pass.
 *
 * Cross-site chain (A's static → B enchanted by Aura
 * pointing at C): when recursing into B, the helper
 * checks B's `copyOfTargetId` ledger. The ledger may
 * be set by an Aura overlay (lane 75d) that ran in
 * a prior pass. When the ledger is set AND the
 * ledger points at a card on the battlefield, the
 * chain continues to that card. This handles the
 * static → aura cross-site chain without
 * conflating the two sources of truth: the script
 * is the primary source (for the current pass's
 * newly-established overlays); the ledger is the
 * secondary source (for cross-site overlays
 * maintained by `refreshAuraBonuses`).
 *
 * The `visited` set is the cycle-detection guard. The
 * helper adds the input `cardId` to `visited` at entry;
 * if any subsequent step revisits a card already in
 * `visited`, the chain contains a cycle and the helper
 * returns the cycle flag (the caller treats the cyclic
 * card as if it had no `become_copy` arm).
 */
function resolveCopyChain(
  cardId: string,
  state: GameState,
  visited: Set<string>,
): { leaf: string; cycle: boolean } {
  if (visited.has(cardId)) {
    return { leaf: cardId, cycle: true };
  }
  visited.add(cardId);
  const card = state.cards.get(cardId as CardInstance["id"]);
  if (!card) return { leaf: cardId, cycle: false };
  // Walk by the SCRIPT's `become_copy` arm. The script
  // is the source-of-truth for the chain. The arm may be
  // on a `StaticSchema` static (lane 75 / 75b / 75c) or
  // on an `AuraStaticSchema` aura static (lane 75d).
  const script = getCardScript(card.cardData.name);
  const arm = findBecomeCopyArm(script);
  if (!arm) {
    // No script-level `become_copy` arm. Check the
    // ledger: a card may participate in a chain as an
    // intermediate even without a script-level
    // `become_copy` (e.g. an enchanted card with an
    // Aura overlay whose `copyOfTargetId` was set by
    // a prior `refreshAuraBonuses` pass). The ledger
    // is the secondary source for the cross-site
    // chain.
    if (card.copyOfTargetId !== undefined) {
      const ledger = card.copyOfTargetId;
      if (ledger.startsWith("name:")) {
        // Named-card form (lane 75b): the named card
        // is NOT on the battlefield; chain terminates
        // at the named card.
        return { leaf: ledger, cycle: false };
      }
      // id form: recurse into the next card. If the
      // next card is missing from `state.cards`,
      // treat the chain as terminating at the
      // missing id.
      const next = state.cards.get(ledger as CardInstance["id"]);
      if (!next) return { leaf: ledger, cycle: false };
      return resolveCopyChain(ledger, state, visited);
    }
    return { leaf: cardId, cycle: false };
  }
  if (arm.named) {
    // Named-card form (lane 75b): the named card is NOT
    // required to be on the battlefield and therefore
    // has no `become_copy` of its own. The leaf IS the
    // named card.
    return { leaf: `name:${arm.target}`, cycle: false };
  }
  // id form: recurse into the next card. If the next
  // card is missing from `state.cards`, treat the
  // chain as terminating at the missing id (the
  // overlay write phase will drop the overlay on a
  // missing target).
  const targetId = arm.target;
  const next = state.cards.get(targetId as CardInstance["id"]);
  if (!next) return { leaf: targetId, cycle: false };
  return resolveCopyChain(targetId, state, visited);
}

/**
 * Read a card's printed `cardData` — the original
 * `cardData` before any overlay writes. The helper
 * mirrors the write phase's preference
 * (`card.animatedUntilEndOfTurn?.cardData ??
 * card.cardData`) so the helper and the write phase
 * agree on "what is printed for this card at this
 * point in the refresh".
 */
function printedCardDataOf(card: CardInstance): ScryfallCard {
  return card.animatedUntilEndOfTurn?.cardData ?? card.cardData;
}

/**
 * The lane 75 / 75b / 75c static form: a `become_copy`
 * arm on `StaticSchema` points the source at a target.
 * The leaf of the chain is determined by walking each
 * card's existing `copyOfTargetId` ledger (from a prior
 * refresh) — at the top of the refresh pass, the
 * ledger reflects the most recent overlay state.
 *
 * The cycle guard returns a snapshot of the leaf for
 * every card that participates in a copy chain (a card
 * with a `become_copy` static that points at another
 * card on the battlefield, OR a card whose prior
 * `copyOfTargetId` ledger names a chain member).
 */
export function buildStaticCopyChainSnapshot(
  state: GameState,
): CopyChainSnapshot {
  const leafBySourceId = new Map<string, string>();
  const leafCardDataBySourceId = new Map<string, ScryfallCard>();
  const cycleIds = new Set<string>();
  // First pass: collect every card id that participates
  // in a copy chain. A card participates if it carries
  // a `become_copy` static OR its prior `copyOfTargetId`
  // ledger names a chain member (the latter covers
  // cards whose overlay is being maintained across
  // refreshes — the prior pass wrote the ledger; the
  // current pass consults the chain to flatten the
  // overlay to the leaf in one pass).
  const candidates = new Set<string>();
  for (const [cardId, card] of state.cards) {
    // The card has a `become_copy` static: it's a
    // chain source.
    const script = getCardScript(card.cardData.name);
    const hasBecomeCopy = script?.statics?.some(
      (s) => s.become_copy !== undefined,
    );
    if (hasBecomeCopy) candidates.add(cardId);
    // The card has an in-flight `copyOfTargetId` from
    // a prior pass: it might be the source of a chain
    // we're resolving (defensive — the next pass will
    // re-stamp the ledger if the static is still
    // active).
    if (card.copyOfTargetId !== undefined) candidates.add(cardId);
  }
  // Second pass: resolve each candidate's chain to its
  // leaf. The cycle guard adds each candidate to a
  // per-chain `visited` set; a revisit flags the cycle.
  for (const cardId of candidates) {
    const visited = new Set<string>();
    const { leaf, cycle } = resolveCopyChain(cardId, state, visited);
    if (cycle) {
      // Cycle: every id in the visited set is part of
      // the cycle. Mark each one as a cycle id — the
      // write phase drops the overlay for each.
      for (const id of visited) cycleIds.add(id);
      continue;
    }
    if (leaf === cardId) continue; // no `become_copy` arm
    // The leaf is a `name:<name>` string (lane 75b) or
    // a `CardInstanceId` (lane 75 / 75a / 75c / 75d).
    // Resolve the leaf's printed `cardData`:
    let leafCardData: ScryfallCard | undefined;
    if (leaf.startsWith("name:")) {
      const name = leaf.slice("name:".length);
      leafCardData = getCardDataByName(name);
    } else {
      const leafCard = state.cards.get(leaf as CardInstance["id"]);
      if (leafCard) leafCardData = printedCardDataOf(leafCard);
    }
    if (leafCardData) {
      leafBySourceId.set(cardId, leaf);
      leafCardDataBySourceId.set(cardId, leafCardData);
    }
  }
  return { leafBySourceId, leafCardDataBySourceId, cycleIds };
}

/**
 * The lane 75d Aura form: an Aura with a `become_copy`
 * arm on `AuraStaticSchema` writes the chosen target's
 * printed characteristics onto the ENCHANTED CARD's
 * `cardData`. The cycle guard resolves the leaf of the
 * chosen target's copy chain (a chosen target that
 * itself has a `become_copy` static) at the top of
 * the refresh pass.
 *
 * The snapshot is keyed by the ENCHANTED card id
 * (the Aura's `attachedToId`), parallel to the
 * `auraCopyOfTargetByEnchantedCard` map the write
 * phase reads at the bottom of `refreshAuraBonuses`.
 * The snapshot's `leafCardDataByEnchantedCard` map is
 * the value the write phase consults to obtain the
 * overlay source.
 */
export interface AuraCopyChainSnapshot {
  leafByEnchantedCard: Map<string, string>;
  leafCardDataByEnchantedCard: Map<string, ScryfallCard>;
  cycleIds: Set<string>;
}

export function buildAuraCopyChainSnapshot(
  state: GameState,
): AuraCopyChainSnapshot {
  const leafByEnchantedCard = new Map<string, string>();
  const leafCardDataByEnchantedCard = new Map<string, ScryfallCard>();
  const cycleIds = new Set<string>();
  // First pass: every enchanted card whose attached
  // Aura carries a `become_copy` arm is a candidate.
  const candidates = new Set<string>();
  for (const card of state.cards.values()) {
    const script = getCardScript(card.cardData.name);
    const auraStatic = script?.aura?.static;
    if (auraStatic?.become_copy === undefined) continue;
    if (card.attachedToId === undefined || card.attachedToId === null) continue;
    candidates.add(card.attachedToId);
  }
  // Second pass: resolve each candidate's chain via
  // the chosen target's ledger. The chosen target is
  // looked up on the Aura's `become_copy.target` field
  // — but the snapshot helper takes the candidate
  // (enchanted card id) and walks the chain by
  // following the chosen target's `copyOfTargetId`
  // ledger. We need to look up the Aura first to find
  // the chosen target.
  for (const enchantedId of candidates) {
    // Find the Aura attached to this enchanted card
    // that has a `become_copy` arm. v1 supports a
    // single such Aura per enchanted card (the
    // "last write wins" semantics in
    // `refreshAuraBonuses`).
    let aura: CardInstance | undefined;
    for (const card of state.cards.values()) {
      if (card.attachedToId !== enchantedId) continue;
      const script = getCardScript(card.cardData.name);
      if (script?.aura?.static?.become_copy === undefined) continue;
      aura = card;
      break;
    }
    if (!aura) continue;
    const auraStatic = getCardScript(aura.cardData.name)?.aura?.static;
    const becomeCopy = auraStatic?.become_copy;
    if (!becomeCopy) continue;
    if (!("target" in becomeCopy)) continue; // v1 only supports the `id` form
    const chosenTargetId = becomeCopy.target;
    // Walk the chosen target's chain to the leaf.
    const visited = new Set<string>();
    const { leaf, cycle } = resolveCopyChain(chosenTargetId, state, visited);
    if (cycle) {
      for (const id of visited) cycleIds.add(id);
      continue;
    }
    let leafCardData: ScryfallCard | undefined;
    if (leaf.startsWith("name:")) {
      const name = leaf.slice("name:".length);
      leafCardData = getCardDataByName(name);
    } else {
      const leafCard = state.cards.get(leaf as CardInstance["id"]);
      if (leafCard) leafCardData = printedCardDataOf(leafCard);
    }
    if (leafCardData) {
      leafByEnchantedCard.set(enchantedId, leaf);
      leafCardDataByEnchantedCard.set(enchantedId, leafCardData);
    }
  }
  return { leafByEnchantedCard, leafCardDataByEnchantedCard, cycleIds };
}
