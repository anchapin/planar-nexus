import { returnToFrontFace } from "./transform";
import { addLoreCounters, isSaga } from "./saga";
import { fireLandfallTriggers } from "./landfall";
import { fireEntersTriggers } from "./enters";
import { detectDiesTriggers } from "./dies";
import { putTriggersOnStack } from "../trigger-system/stack-ops";
import { applyEntersWithCounters } from "./enters-with-counters";
import { isCreatureOnCurrentFace, markCreatureDiedThisTurn } from "./morbid";
import { buildScriptedDeathReplacementEffects } from "../card-scripts/replacement-effect-bindings";
import { tapCardAction, untapCardAction } from "./damage-tap";
import { loseLife } from "../player-actions";
// Wave 4.8 follow-up 20 lane 61 sub-piece (#2614
// follow-up, follow-up 20 piece 1): the
// library-top / library-bottom death-replacement
// redirects thread `position` through the data
// layer (`moveCardBetweenZones` / `addCardToZone`),
// so the consult's new `moveCardToZoneWithPosition`
// helper imports the primitive. The narrow-union
// `moveCardToZone` API does NOT carry position
// (out of scope to widen — every other call-site
// ignores it).
import { moveCardBetweenZones } from "../zones";
/**
 * Zone-removal keyword actions (CR 701): destroy, exile, sacrifice, regenerate, and generic zone moves.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstance, CardInstanceId, Zone } from "../types";
import {
  addCounters,
  removeCounters,
  hasCounter,
  initializePlaneswalkerLoyalty,
} from "../card-instance";
import { hasIndestructibleKeyword } from "./indestructible";
import { KeywordActionResult } from "./shared";
import { getCardScript } from "../card-scripts/registry";

/**
 * Check if a card has indestructible
 *
 * Issue #2350: this used to be
 * `keywords.includes("Indestructible") || oracleText.includes("indestructible")`
 * — a **case-sensitive** keyword match plus an **unanchored** oracle-text one.
 * The case-sensitivity was a live correctness bug, not a style nit: a card
 * tagged `keywords: ["indestructible"]` (imported decks, tokens, hand-built
 * card data — Scryfall itself is title-case) fell through both arms, so SBA
 * 704.5g destroyed a genuinely indestructible permanent. The oracle arm also
 * matched grant phrases, pinning a card that merely *gives* indestructible to
 * others as itself being unkillable.
 *
 * It now delegates to `hasIndestructibleKeyword` (CR 702.12a) — the single
 * canonical gate, shared with `evergreen-keywords.isIndestructible` so the two
 * copies cannot drift apart again. See `keyword-actions/indestructible.ts`.
 *
 * CR 702.12b — this guards DESTRUCTION only. It does not stop a permanent from
 * being put into a graveyard directly (0-toughness SBA, sacrifice, exile), so
 * callers applying those must pass `ignoreIndestructible`.
 */
export function hasIndestructible(card: CardInstance): boolean {
  return hasIndestructibleKeyword(card);
}

/**
 * Check if a card can be regenerated (has regenerate ability)
 */
export function canBeRegenerated(card: CardInstance): boolean {
  const oracleText = card.cardData.oracle_text?.toLowerCase() || "";
  return oracleText.includes("regenerate");
}

/**
 * Destroy a permanent
 * Handles indestructible and regeneration
 */
export function destroyCard(
  state: GameState,
  cardId: CardInstanceId,
  ignoreIndestructible: boolean = false,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  // Check for indestructible
  if (!ignoreIndestructible && hasIndestructible(card)) {
    return {
      success: false,
      state,
      description: `${card.cardData.name} is indestructible and cannot be destroyed`,
    };
  }

  // Check for replacement effects (e.g., "If a creature would be destroyed, exile it instead")
  const replacementEvent = {
    type: "destroy" as const,
    amount: 0,
    timestamp: Date.now(),
    targetId: cardId,
  };

  const rem = state.replacementEffectManager;
  const apnapOrder = rem.createAPNAPOrder(
    state.turn.activePlayerId,
    Array.from(state.players.keys()),
  );
  const processedEvent = rem.processEvent(replacementEvent, apnapOrder);

  if (processedEvent.type === "exile") {
    // Replacement effect changed destroy to exile
    return exileCard(state, cardId);
  }

  // CR 701.13: If the permanent has a regeneration shield, consume exactly one
  // shield INSTEAD of destroying it — the permanent is tapped, all damage is
  // removed, and it stays on the battlefield (never moved to the graveyard).
  // Bypassed when ignoreIndestructible is set, matching the "cannot be
  // replaced" destroy contract used by the state-based annihilate paths.
  if (!ignoreIndestructible) {
    const shieldResult = consumeRegenerationShield(state, cardId);
    if (shieldResult.hasShield) {
      const shieldedCard = shieldResult.state.cards.get(cardId);
      if (shieldedCard) {
        const regeneratedCard = {
          ...shieldedCard,
          damage: 0,
          isTapped: true,
        };
        const regeneratedCards = new Map(shieldResult.state.cards);
        regeneratedCards.set(cardId, regeneratedCard);
        return {
          success: true,
          state: {
            ...shieldResult.state,
            cards: regeneratedCards,
            lastModifiedAt: Date.now(),
          },
          description: `${shieldedCard.cardData.name} regenerates (shield consumed)`,
          affectedCards: [cardId],
        };
      }
    }
  }

  // Move card to graveyard
  return moveCardToZone(state, cardId, "graveyard");
}

/**
 * Exile a card
 * Can be face-up or face-down
 */
export function exileCard(
  state: GameState,
  cardId: CardInstanceId,
  faceDown: boolean = false,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  // Use cached zone key for O(1) lookup if available, otherwise search
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = card.currentZoneKey;

  if (currentZoneKey) {
    currentZone = state.zones.get(currentZoneKey) ?? null;
    // A stale cache (the card moved without the key being updated) must not
    // be trusted, or the card is copied into the destination and left behind.
    if (currentZone && !currentZone.cardIds.includes(cardId)) {
      currentZone = null;
      currentZoneKey = null;
    }
  }

  if (!currentZone) {
    // Fallback: search all zones (for cards created before cache existed)
    for (const [zoneKey, zone] of state.zones) {
      if (zone.cardIds.includes(cardId)) {
        currentZone = zone;
        currentZoneKey = zoneKey;
        break;
      }
    }
  }

  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} is not in any zone`,
    };
  }

  // Determine exile zone (player's exile or shared exile)
  const exileZoneKey = card.controllerId
    ? `${card.controllerId}-exile`
    : "exile";

  const exileZone = state.zones.get(exileZoneKey);

  if (!exileZone) {
    return {
      success: false,
      state,
      description: "",
      error: `Exile zone not found`,
    };
  }

  // Update card state. A newly exiled card is a new object (CR 400.7), so
  // any earlier "exiled with" link is dropped; the exiling source relinks
  // it when its script counts cards exiled with it (#2614 Keen-Eyed Curator).
  const { exiledWith: _staleLink, ...rest } = card;
  void _staleLink;
  const updatedCard = {
    ...rest,
    isFaceDown: faceDown,
    attachedToId: null, // Detach from any attachments
    attachedCardIds: [], // Remove any attachments
    currentZoneKey: exileZoneKey,
  };

  // Update zones
  const updatedCurrentZone = {
    ...currentZone,
    cardIds: currentZone.cardIds.filter((id) => id !== cardId),
  };

  const updatedExileZone = {
    ...exileZone,
    cardIds: [...exileZone.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, updatedCurrentZone);
  updatedZones.set(exileZoneKey, updatedExileZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const faceDownText = faceDown ? " face down" : "";

  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Exiled ${card.cardData.name}${faceDownText}`,
    affectedCards: [cardId],
  };
}

/**
 * Sacrifice a permanent
 * The controller of the sacrificed card chooses what to sacrifice
 */
export function sacrificeCard(
  state: GameState,
  cardId: CardInstanceId,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  // Move to graveyard (sacrificed cards go to owner's graveyard)
  return moveCardToZone(state, cardId, "graveyard");
}

// ---------------------------------------------------------------------------
// Blitz (CR 702.150)
//
// Blitz is an alternative cost. When a creature is cast for its blitz cost it
// gains haste, a "When this creature dies, draw a card" triggered ability, and
// a delayed "sacrifice it at the beginning of the next end step" trigger. The
// `blitz` marker on the CardInstance (set in spell-casting at resolution) is
// the single source of truth; the helpers below consume it so the effects fire
// exactly once and only for creatures actually cast via the blitz cost.
// ---------------------------------------------------------------------------

/**
 * Regenerate a permanent
 * Creates a "regeneration shield" that prevents destruction
 */
export function regenerateCard(
  state: GameState,
  cardId: CardInstanceId,
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  // Check if the card has regenerate ability
  // In a full implementation, this would check if the ability was activated
  // For now, we allow regeneration if the card could theoretically have it

  // Remove all damage
  const updatedCard = {
    ...card,
    damage: 0,
    isTapped: false, // Untap the card
  };

  // Add regeneration shield counter (using a special counter type)
  const updatedCardWithShield = addCounters(
    updatedCard,
    "regeneration-shield",
    1,
  );

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCardWithShield);

  return {
    success: true,
    state: {
      ...state,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Regenerated ${card.cardData.name}`,
    affectedCards: [cardId],
  };
}

/**
 * Check and consume regeneration shield
 * Called when a card would be destroyed
 */
export function consumeRegenerationShield(
  state: GameState,
  cardId: CardInstanceId,
): { hasShield: boolean; state: GameState } {
  const card = state.cards.get(cardId);

  if (!card) {
    return { hasShield: false, state };
  }

  if (hasCounter(card, "regeneration-shield")) {
    // Remove one regeneration shield
    const updatedCard = removeCounters(card, "regeneration-shield", 1);
    const updatedCards = new Map(state.cards);
    updatedCards.set(cardId, updatedCard);

    return {
      hasShield: true,
      state: {
        ...state,
        cards: updatedCards,
        lastModifiedAt: Date.now(),
      },
    };
  }

  return { hasShield: false, state };
}

/**
 * Move a card to a specific zone
 */
export function moveCardToZone(
  state: GameState,
  cardId: CardInstanceId,
  targetZoneType: "graveyard" | "exile" | "hand" | "library" | "battlefield",
): KeywordActionResult {
  // Finality counter (CR 122.1h): a creature with one that would die is
  // exiled instead, so it never dies (#2614 Esper Origins).
  if (targetZoneType === "graveyard" && hasFinalityCounter(state, cardId)) {
    targetZoneType = "exile";
  }
  // Wave 4.8 follow-up 13 lane 61a (#2614 follow-up): the
  // foundational death-replacement consult. When a creature
  // would move from the battlefield to the graveyard, ask
  // `state.replacementEffectManager` whether any registered
  // `death_replacement` arm wants to redirect the dying
  // permanent (CR 614.1). v1 supports `redirect.to: "exile"`
  // (Whip of Erebos); other destinations ride follow-up lanes
  // (100 / 101 / 104).
  //
  // The consult runs BEFORE the move and BEFORE the dies-trigger
  // snapshot so the replacement effect runs on the "would die"
  // event with the battlefield still intact (CR 603.10a — the
  // dies triggers look back at the battlefield the permanent
  // left; the replacement consult decides whether it leaves
  // at all). The `processEvent` APNAP ordering handles
  // multi-player ties; the per-effect `canApply` filters
  // implement the "if a creature you control would die"
  // controller filter.
  //
  // The consult builds a fresh set of `ReplacementAbility`
  // entries from every battlefield card's
  // `CardScript.replacement_effects` arm, registers them
  // on the manager, runs `processEvent`, then clears the
  // just-registered entries via `removeEffectsFromSource`
  // before returning. This keeps the manager stateless
  // w.r.t. death-replacement — the consult is the single
  // owner of the effect list (parallel to how
  // `refreshScriptedStatics` rebuilds the static layer
  // every refresh pass instead of maintaining a permanent
  // registration).
  // Wave 4.8 follow-up 13 lane 101 (#2614 follow-up):
  // when the redirect is "sacrifice", the dying
  // creature doesn't actually die (it's sacrificed
  // instead — CR 614.9) so dies triggers don't fire
  // post-consult. The flag is declared in the outer
  // scope (moveCardToZone's outer scope, NOT the
  // consult's inner scope) so the post-consult path
  // can read it.
  const isSacrificeRedirect = { value: false };
  // Wave 4.8 follow-up 13 lane 104 (#2614 follow-up):
  // when the redirect is "battlefield_tapped" /
  // "battlefield_untapped" / "life_loss" (periodic
  // self-replacement destinations), the card stays
  // on the battlefield and a side-effect applies
  // instead of a zone move. The flag carries the
  // kind + amount through to the post-consult
  // handler below.
  const pendingPeriodicRedirect: {
    value: { kind: string; amount: number } | null;
  } = { value: null };
  // Wave 4.8 follow-up 20 lane 61 sub-piece
  // (#2614 follow-up, follow-up 20 piece 1):
  // when the redirect is "library_top" or
  // "library_bottom", the dying card is moved to
  // the OWNER's library (CR 400.3 — a card put into
  // a library goes to its owner's library, even when
  // a different player controlled it) at a specific
  // position (top of library = "drawn first" = the
  // END of the `cardIds` array; bottom of library =
  // the START of the array). The narrow `targetZoneType`
  // union above ("... | library | ...") doesn't carry
  // position, so the consult uses this flag to route
  // through the new `moveCardToZoneWithPosition`
  // helper instead of the standard
  // `moveCardToZoneWithoutTriggers` path. Like the
  // exile / hand redirects, dies triggers DO NOT
  // fire (the creature didn't die — CR 614.5).
  const pendingLibraryRedirect: {
    value: { position: "top" | "bottom" } | null;
  } = { value: null };
  if (targetZoneType === "graveyard") {
    const cardForConsult = state.cards.get(cardId);
    const sourceZoneKey = cardForConsult?.currentZoneKey ?? null;
    const onBattlefield = sourceZoneKey?.endsWith("-battlefield") ?? false;
    if (onBattlefield && cardForConsult) {
      const consultEvent = {
        type: "would_die" as const,
        timestamp: Date.now(),
        targetId: cardId,
        sourceId: cardId,
        controllerId: cardForConsult.controllerId,
        amount: 0,
      };
      const effects =
        buildScriptedDeathReplacementEffects(state, cardId);
      for (const eff of effects) {
        state.replacementEffectManager.registerEffect(eff);
      }
      try {
        const apnapOrder =
          state.replacementEffectManager.createAPNAPOrder(
            state.turn.activePlayerId,
            Array.from(state.players.keys()),
          );
        const processed = state.replacementEffectManager.processEvent(
          consultEvent,
          apnapOrder,
        );
        // `processEvent` returns the resulting
        // `ReplacementEvent` (not the `ReplacementResult`),
        // so the redirect destination rides on the event's
        // `context` side-channel. The lane 61a
        // `apply` function stamps `redirectToZone`
        // there when the death-replacement fires.
        //
        // Wave 4.8 follow-up 13 lane 100 (#2614 follow-up):
        // added `redirect === "hand"` (Whip of Erebos's
        // deferred hand-redirect — "if [thing] would die,
        // instead return it to its owner's hand"). The
        // lane 61a schema arm already accepts "hand" in
        // the enum; this branch wires the engine consult
        // to route the dying card to the owner's hand.
        //
        // Wave 4.8 follow-up 13 lane 101 (#2614 follow-up):
        // added `redirect === "sacrifice"` (False Dawn's
        // deferred sacrifice-redirect — "if [thing]
        // would die, instead sacrifice it"). The
        // semantics: route the dying card to the owner's
        // graveyard via the `sacrificeCard` path (which
        // bumps the `state.turn.creatureDiedThisTurn`
        // counter via `markCreatureDiedThisTurn` and
        // routes through the dedicated sacrifice
        // keyword path). This is structurally different
        // from a plain `moveCardToZone` to graveyard
        // (which would just be the death's normal
        // destination).
        //
        // Out of scope: "library_top" /
        // "library_bottom" / "any_zone" (lane 104
        // partial — covered by lane 101's
        // sacrifice-redirect as a sibling case).
        const redirect = processed.context?.redirectToZone;
        if (redirect === "exile") {
          targetZoneType = "exile";
        } else if (redirect === "hand") {
          targetZoneType = "hand";
        } else if (redirect === "sacrifice") {
          // Wave 4.8 follow-up 13 lane 101 (#2614
          // follow-up): the dying creature doesn't die
          // — it's sacrificed instead (CR 614.9). The
          // flag suppresses dies triggers below (a
          // sacrificed creature is not "dying" for
          // CR 603.10a purposes); the move to graveyard
          // happens via `sacrificeCard` below.
          isSacrificeRedirect.value = true;
        } else if (
          redirect === "library_top" ||
          redirect === "library_bottom"
        ) {
          // Wave 4.8 follow-up 20 lane 61 sub-piece
          // (#2614 follow-up, follow-up 20 piece 1):
          // route the dying card to its owner's
          // library at top ("drawn first") or bottom
          // ("drawn last"). The post-consult path
          // (below) consults `pendingLibraryRedirect`
          // and uses the new
          // `moveCardToZoneWithPosition` helper —
          // which threads `position` through to
          // `moveCardBetweenZones` /
          // `addCardToZone` (data layer). Like the
          // exile / hand redirects, dies triggers do
          // NOT fire (the card didn't die — CR 614.5
          // "instead" replaces the original event).
          pendingLibraryRedirect.value = {
            position:
              redirect === "library_top" ? "top" : "bottom",
          };
        } else if (
          redirect === "battlefield_tapped" ||
          redirect === "battlefield_untapped" ||
          redirect === "life_loss"
        ) {
          // Wave 4.8 follow-up 13 lane 104 (#2614
          // follow-up): periodic self-replacement
          // destinations. The card stays on the
          // battlefield (no move-to-graveyard); the
          // post-consult path applies the side effect
          // (tap / untap / life loss) and skips the
          // default move below.
          pendingPeriodicRedirect.value = {
            kind: redirect,
            amount: (processed.context?.redirectToZoneAmount ?? 0) as number,
          };
        }
      } finally {
        // Always clear, even when `processEvent` throws.
        for (const eff of effects) {
          state.replacementEffectManager.removeEffectsFromSource(
            eff.sourceCardId,
          );
        }
      }
    }
  }
  // CR 603.10a: dies triggers look back at the battlefield before the move.
  // The lane 101 sacrifice-redirect sets `isSacrificeRedirect.value`
  // when the redirect is "sacrifice" — a sacrificed creature
  // doesn't fire dies triggers (the sacrifice path replaces the
  // death path; CR 614.9 "instead" effects skip the wait).
  //
  // Wave 4.8 follow-up 13 lane 104 (#2614 follow-up):
  // periodic self-replacement ("instead tap it" /
  // "instead lose 1 life"). The card stays on the
  // battlefield; a side-effect applies. The consult
  // set `pendingPeriodicRedirect.value` to a non-null
  // object; we apply the side effect and skip the
  // default move-to-graveyard.
  if (pendingPeriodicRedirect.value !== null) {
    const { kind, amount } = pendingPeriodicRedirect.value;
    if (kind === "battlefield_tapped") {
      const tapResult = tapCardAction(state, cardId);
      state = tapResult.success ? tapResult.state : state;
    } else if (kind === "battlefield_untapped") {
      const untapResult = untapCardAction(state, cardId);
      state = untapResult.success ? untapResult.state : state;
    } else if (kind === "life_loss") {
      const dyingCard = state.cards.get(cardId);
      const ownerId = dyingCard?.ownerId;
      if (ownerId) {
        state = loseLife(state, ownerId, amount, cardId);
      }
    }
    return {
      success: true,
      state,
      description: `Periodic replacement (${kind}) applied; creature stays on battlefield.`,
      affectedCards: [cardId],
    };
  }
  // Wave 4.8 follow-up 20 lane 61 sub-piece (#2614
  // follow-up, follow-up 20 piece 1): the
  // library-top / library-bottom redirect routes
  // the dying card to its owner's library at a
  // specific position via the new
  // `moveCardToZoneWithPosition` helper. Dies
  // triggers are NOT taken — the card didn't die
  // (CR 614.5 "instead" replaces the original
  // event; CR 603.10a dies triggers look back at
  // a "dying" permanent, not a "moved to library"
  // permanent). Early-return after the move.
  if (pendingLibraryRedirect.value !== null) {
    const { position } = pendingLibraryRedirect.value;
    const moved = moveCardToZoneWithPosition(
      state,
      cardId,
      position,
    );
    if (!moved.success) {
      return moved;
    }
    return {
      ...moved,
      description: `Death replacement moved dying card to owner's library (${position}).`,
      affectedCards: [cardId],
    };
  }
  const diesTriggers =
    targetZoneType === "graveyard" && !isSacrificeRedirect.value
      ? detectDiesTriggers(state, cardId)
      : [];
  const result = moveCardToZoneWithoutTriggers(state, cardId, targetZoneType);
  if (result.success && diesTriggers.length > 0) {
    return {
      ...result,
      state: putTriggersOnStack(result.state, diesTriggers).state,
    };
  }
  // Landfall (CR 207.2c): a land put onto the battlefield triggers its
  // controller's landfall abilities.
  if (result.success && targetZoneType === "battlefield") {
    // CR 614.1c: "enters with" counters are on it before any trigger sees it.
    const withCounters = applyEntersWithCounters(result.state, cardId);
    const withLandfall = fireLandfallTriggers(withCounters, cardId);
    const entered = fireEntersTriggers(withLandfall, cardId);
    // CR 714.3a: a Saga enters with a lore counter (chapter I triggers).
    const saga = entered.cards.get(cardId);
    return {
      ...result,
      state: saga && isSaga(saga) ? addLoreCounters(entered, cardId) : entered,
    };
  }
  return result;
}

function hasFinalityCounter(state: GameState, cardId: CardInstanceId): boolean {
  const card = state.cards.get(cardId);
  if (!card || !isCreatureOnCurrentFace(card)) return false;
  const battlefield = state.zones.get(`${card.controllerId}-battlefield`);
  if (!battlefield?.cardIds.includes(cardId)) return false;
  return (
    card.counters?.some((c) => c.type === "finality" && c.count > 0) ?? false
  );
}

/**
 * Wave 4.8 follow-up 20 lane 61 sub-piece (#2614
 * follow-up, follow-up 20 piece 1): move a card
 * from its current zone to its OWNER's library at
 * the named position. CR 400.3 — a card put into
 * a library goes to its owner's library (the
 * controller is irrelevant; only the owner
 * matters). The helper threads `position` through
 * to the data layer `moveCardBetweenZones`, which
 * delegates to `addCardToZone(zone, cardId,
 * position)` — `position: "top"` puts the card at
 * the END of the `cardIds` array (the top of the
 * library = "drawn first"); `position: "bottom"`
 * puts it at the START (drawn last).
 *
 * The helper is intentionally narrow: it does not
 * re-implement `moveCardToZone`'s broad union of
 * side-effects (CR 712.8a transform-front, CR 400.7
 * "new object", counters reset, ETB counter
 * initialization, etc.) — the death-replacement
 * path is exempt from all of those (the card
 * didn't die; it's a transient deferral). Only the
 * minimum move + `currentZoneKey` re-stamp is
 * applied. The helper is private to
 * `moveCardToZone`'s consult.
 */
function moveCardToZoneWithPosition(
  state: GameState,
  cardId: CardInstanceId,
  position: "top" | "bottom",
): KeywordActionResult {
  const card = state.cards.get(cardId);
  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }
  // Find the current zone the same way
  // `moveCardToZoneWithoutTriggers` does (cached
  // `currentZoneKey` first, fall back to
  // scanning).
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = card.currentZoneKey;
  if (currentZoneKey) {
    currentZone = state.zones.get(currentZoneKey) ?? null;
    if (currentZone && !currentZone.cardIds.includes(cardId)) {
      currentZone = null;
      currentZoneKey = null;
    }
  }
  if (!currentZone || !currentZoneKey) {
    for (const [zoneKey, zone] of state.zones) {
      if (zone.cardIds.includes(cardId)) {
        currentZone = zone;
        currentZoneKey = zoneKey;
        break;
      }
    }
  }
  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} is not in any zone`,
    };
  }
  // CR 400.3: the owner's library, not the
  // controller's.
  const targetZoneKey = `${card.ownerId}-library`;
  const targetZone = state.zones.get(targetZoneKey);
  if (!targetZone) {
    return {
      success: false,
      state,
      description: "",
      error: `Target zone ${targetZoneKey} not found`,
    };
  }
  // Delegate the data-layer move (which honors
  // `position`).
  const { from, to } = moveCardBetweenZones(
    currentZone,
    targetZone,
    cardId,
    position,
  );
  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, from);
  updatedZones.set(targetZoneKey, to);
  // Re-stamp `currentZoneKey` (CR 400.7: a card
  // that changes zones is a new object; we keep
  // the rest of the card identity — only the
  // zone-key cache updates. Counts / status
  // reset is EXEMPT for library-deferral
  // redirects: the card is unchanged; it's
  // deferred, not destroyed).
  const updatedCard: CardInstance = {
    ...card,
    currentZoneKey: targetZoneKey,
  };
  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);
  return {
    success: true,
    state: {
      ...state,
      zones: updatedZones,
      cards: updatedCards,
      lastModifiedAt: Date.now(),
    },
    description: `Moved ${card.cardData.name} to owner's library at ${position}`,
    affectedCards: [cardId],
  };
}

function moveCardToZoneWithoutTriggers(
  state: GameState,
  cardId: CardInstanceId,
  targetZoneType: "graveyard" | "exile" | "hand" | "library" | "battlefield",
): KeywordActionResult {
  const card = state.cards.get(cardId);

  if (!card) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} not found`,
    };
  }

  // Use cached zone key for O(1) lookup if available, otherwise search
  let currentZone: Zone | null = null;
  let currentZoneKey: string | null = card.currentZoneKey;

  if (currentZoneKey) {
    currentZone = state.zones.get(currentZoneKey) ?? null;
    // A stale cache (the card moved without the key being updated) must not
    // be trusted, or the card is copied into the destination and left behind.
    if (currentZone && !currentZone.cardIds.includes(cardId)) {
      currentZone = null;
      currentZoneKey = null;
    }
  }

  if (!currentZone) {
    // Fallback: search all zones (for cards created before cache exists)
    for (const [zoneKey, zone] of state.zones) {
      if (zone.cardIds.includes(cardId)) {
        currentZone = zone;
        currentZoneKey = zoneKey;
        break;
      }
    }
  }

  if (!currentZone || !currentZoneKey) {
    return {
      success: false,
      state,
      description: "",
      error: `Card ${cardId} is not in any zone`,
    };
  }

  // Determine target zone
  let targetZoneKey: string;

  if (targetZoneType === "library") {
    // Libraries are always player's own
    targetZoneKey = `${card.ownerId}-library`;
  } else if (targetZoneType === "graveyard") {
    // Graveyards are owner's
    targetZoneKey = `${card.ownerId}-graveyard`;
  } else if (targetZoneType === "exile") {
    // Exile can be controller's or shared
    targetZoneKey = card.controllerId ? `${card.controllerId}-exile` : "exile";
  } else if (targetZoneType === "hand") {
    // CR 400.3: a card put into a hand goes to its owner's hand.
    targetZoneKey = `${card.ownerId}-hand`;
  } else if (targetZoneType === "battlefield") {
    targetZoneKey = `${card.controllerId}-battlefield`;
  } else {
    return {
      success: false,
      state,
      description: "",
      error: `Invalid target zone: ${targetZoneType}`,
    };
  }

  const targetZone = state.zones.get(targetZoneKey);

  if (!targetZone) {
    return {
      success: false,
      state,
      description: "",
      error: `Target zone ${targetZoneKey} not found`,
    };
  }

  // Handle special cases. CR 712.8a: a transformed card that leaves the
  // battlefield is its front face in every other zone.
  // Clear the zone cache rather than pin it: casting and resolution don't
  // maintain currentZoneKey, so a key set here would go stale on the next
  // cast. Readers fall back to scanning zones when it is null.
  let updatedCard: CardInstance = {
    ...(targetZoneType === "battlefield" ? card : returnToFrontFace(card)),
    currentZoneKey: null,
    // CR 400.7: a card that changes zones is a new object.
    activatedOnceAbilities: undefined,
    activatedThisTurn: undefined,
  };

  if (targetZoneType === "graveyard" || targetZoneType === "library") {
    // Reset certain states when moving to graveyard or library
    updatedCard = {
      ...updatedCard,
      isTapped: false,
      isFaceDown: false,
      attachedToId: null,
      attachedCardIds: [],
      damage: 0,
      counters: [], // Remove counters
    };
  } else if (targetZoneType === "battlefield") {
    // Set summoning sickness for permanents entering battlefield
    updatedCard = {
      ...updatedCard,
      hasSummoningSickness: true,
      enteredBattlefieldTimestamp: Date.now(),
    };
    // Initialize loyalty counters for planeswalkers (CR 306.5b)
    updatedCard = initializePlaneswalkerLoyalty(updatedCard);
    // #2594 follow-up (lane 19): "This creature enters the
    // battlefield tapped." (Diregraf Ghoul — FDN #80.) When the
    // script's `entersTapped` flag is set, stamp isTapped here
    // (the engine's ETB triggers below fire as the card is
    // already on the battlefield with the tapped state set).
    const script = getCardScript(card.cardData.name);
    if (script?.entersTapped) {
      updatedCard = { ...updatedCard, isTapped: true };
    }
  }

  // Update zones
  const updatedCurrentZone = {
    ...currentZone,
    cardIds: currentZone.cardIds.filter((id) => id !== cardId),
  };

  const updatedTargetZone = {
    ...targetZone,
    cardIds: [...targetZone.cardIds, cardId],
  };

  const updatedZones = new Map(state.zones);
  updatedZones.set(currentZoneKey, updatedCurrentZone);
  updatedZones.set(targetZoneKey, updatedTargetZone);

  const updatedCards = new Map(state.cards);
  updatedCards.set(cardId, updatedCard);

  const zoneNames: Record<string, string> = {
    graveyard: "graveyard",
    exile: "exile",
    hand: "hand",
    library: "library",
    battlefield: "battlefield",
  };

  let movedState: GameState = {
    ...state,
    zones: updatedZones,
    cards: updatedCards,
    lastModifiedAt: Date.now(),
  };
  // CR 700.4: "dies" means put into a graveyard from the battlefield. Morbid
  // (issue #2300) asks whether that happened to any creature this turn.
  if (
    targetZoneType === "graveyard" &&
    currentZoneKey.endsWith("-battlefield") &&
    isCreatureOnCurrentFace(card)
  ) {
    movedState = markCreatureDiedThisTurn(movedState);
  }
  // CR 111.8: a token that leaves the battlefield ceases to exist (as a
  // state-based action, CR 704.5d). In a hand it would otherwise be playable.
  if (targetZoneType === "hand" && card.isToken) {
    const zones = new Map(movedState.zones);
    zones.set(targetZoneKey, targetZone);
    const cards = new Map(movedState.cards);
    cards.delete(cardId);
    movedState = { ...movedState, zones, cards };
  }

  return {
    success: true,
    state: movedState,
    description: `Moved ${card.cardData.name} to ${zoneNames[targetZoneType]}`,
    affectedCards: [cardId],
  };
}
