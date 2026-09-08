/**
 * Cycling family (CR 702.18 and type/landcycling variants): cost parsing, activation, and library search.
 *
 * Mechanically extracted from keyword-actions.ts (issue #1725);
 * behavior pinned by the existing engine suites.
 */
import type { GameState, CardInstance, CardInstanceId, PlayerId, Zone, ScryfallCard } from '../types';
import { Phase } from '../types';
import { shuffleZone } from '../zones';
import { spendMana } from '../mana';
import { parseCycling, CyclingVariant, CyclingInfo } from '../oracle-text-parser';
import { isPriorityPlayer } from '../priority-guard';
import { drawCards } from './draw';
import { moveCardToZone } from './removal';
import { KeywordActionResult } from './shared';

/**
 * Parse the cycling keyword from oracle text. Thin convenience wrapper around
 * `parseCycling` returning the legacy `number | null` shape — used by
 * tests/UI that pre-date the CyclingInfo object.
 */
export function parseCyclingCost(
  text: string | null | undefined,
): number | null {
  if (!text) return null;
  const info = parseCycling(text);
  if (!info.hasCycling || !info.cost) return null;
  return info.cost.generic;
}

/**
 * Internal: read the ScryfallCard-shaped `cardData` block off either a
 * CardInstance or a ScryfallCard. Both types expose the same fields we need
 * (oracle_text, keywords, type_line) so we treat them uniformly.
 */
function getCyclingCardData(card: CardInstance | ScryfallCard): ScryfallCard {
  if ("cardData" in card && card.cardData) {
    return card.cardData as ScryfallCard;
  }
  return card as ScryfallCard;
}

/**
 * Return true if the card has any cycling variant (Cycling / Typecycling /
 * Landcycling / Basic landcycling) parsed from oracle text or the keywords
 * array. CR 702.30-31.
 */
export function hasCycling(card: CardInstance | ScryfallCard): boolean {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  const keywords = data.keywords ?? [];
  if (oracleText && parseCycling(oracleText).hasCycling) {
    return true;
  }
  return keywords.some((k) => /cycling/i.test(k));
}

/**
 * Return true if the card has a Landcycling variant (either bare
 * "Landcycling" or "[Type] landcycling" / "Basic landcycling"). If `landType`
 * is supplied, only return true when the parsed variant is restricted to that
 * specific basic land subtype.
 */
export function hasLandcycling(
  card: CardInstance | ScryfallCard,
  landType?: string,
): boolean {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  if (!oracleText) return false;
  const info = parseCycling(oracleText);
  if (
    !info.hasCycling ||
    (info.variant !== CyclingVariant.LANDCYCLING &&
      info.variant !== CyclingVariant.BASIC_LANDCYCLING)
  ) {
    return false;
  }
  if (landType !== undefined) {
    return info.basicLandType === landType;
  }
  return true;
}

/**
 * Return true if the card has a Typecycling variant (e.g. Wizardcycling,
 * Slivercycling). When `cardType` is supplied, only return true when the
 * parsed cycling variant targets that specific card type.
 */
export function hasTypecycling(
  card: CardInstance | ScryfallCard,
  cardType?: string,
): boolean {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  if (!oracleText) return false;
  const info = parseCycling(oracleText);
  if (!info.hasCycling || info.variant !== CyclingVariant.TYPECYCLING) {
    return false;
  }
  if (cardType !== undefined) {
    return info.type === cardType;
  }
  return true;
}

/**
 * Return the parsed cycling mana cost as a `ParsedManaCost`, or `null` if the
 * card does not have cycling. The "discard this card" portion of the cost is
 * implicit (CR 702.30a) and is not included in the returned object.
 */
export function getCyclingCost(
  card: CardInstance | ScryfallCard,
): CyclingInfo["cost"] {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  if (!oracleText) return null;
  return parseCycling(oracleText).cost;
}

/**
 * Return the full parsed cycling descriptor for the card (variant + cost +
 * named type). Useful when the caller needs to distinguish the variants (e.g.
 * to drive the correct effect after the cost is paid).
 */
export function getCyclingVariant(
  card: CardInstance | ScryfallCard,
): CyclingInfo {
  const data = getCyclingCardData(card);
  const oracleText = data.oracle_text ?? "";
  if (!oracleText) {
    return {
      hasCycling: false,
      variant: null,
      cost: null,
      costString: null,
      type: null,
      basicLandType: null,
      description: "",
    };
  }
  return parseCycling(oracleText);
}

/**
 * Check whether `playerId` may cycle `card` right now.
 *
 * CR 702.30a: Cycling functions only while the card is in a player's hand.
 * CR 117.1a / 602.2: Activated abilities follow normal timing — sorcery
 * timing applies (active player, main phase, empty stack, player has
 * priority). CR 602.5b: A cost requiring a payment (e.g. discard) can only
 * be activated when the payment can be made; we additionally require the
 * player can pay the mana cost.
 */
export function canCycleCard(
  state: GameState,
  playerId: PlayerId,
  card: CardInstance,
): boolean {
  if (!state || !card) return false;
  if (card.controllerId !== playerId && card.ownerId !== playerId) return false;

  // CR 702.30a: cycling is hand-only.
  const handZone = state.zones.get(`${playerId}-hand`);
  if (!handZone || !handZone.cardIds.includes(card.id)) {
    return false;
  }

  // Must have cycling.
  if (!hasCycling(card)) return false;

  // Sorcery-speed timing (active player, main phase, empty stack, priority).
  if (state.status !== "in_progress") return false;
  if (state.turn.activePlayerId !== playerId) return false;
  if (
    state.turn.currentPhase !== Phase.PRECOMBAT_MAIN &&
    state.turn.currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
    return false;
  }
  if (state.stack.length > 0) return false;
  if (!isPriorityPlayer(state, playerId)) return false;

  // Must be able to pay the cycling mana cost.
  const cost = getCyclingCost(card);
  if (cost) {
    const player = state.players.get(playerId);
    if (!player) return false;
    const pool = player.manaPool;
    const coloredShortfall =
      cost.white > pool.white ||
      cost.blue > pool.blue ||
      cost.black > pool.black ||
      cost.red > pool.red ||
      cost.green > pool.green ||
      cost.colorless > pool.colorless;
    if (coloredShortfall) return false;
    const availableGeneric =
      pool.generic +
      pool.white +
      pool.blue +
      pool.black +
      pool.red +
      pool.green;
    if (cost.generic > availableGeneric) return false;
  }

  return true;
}

/**
 * Activate Cycling / Typecycling / Landcycling on `cardId` (CR 702.30-31).
 *
 * Steps (in order):
 *  1. Verify the card exists, is in the player's hand, and has cycling.
 *  2. Verify sorcery-speed timing (active player, main phase, empty stack,
 *     player has priority).
 *  3. Pay the cycling mana cost from the player's mana pool.
 *  4. Move the cycled card from hand → graveyard (the discard is a cost of
 *     the ability, CR 601.2g, and does not use the stack).
 *  5. Resolve the effect:
 *       - CYCLING              → draw a card (CR 702.30a).
 *       - LANDCYCLING /
 *         BASIC_LANDCYCLING   → search library for a land of the named type
 *                                (or any basic land for the bare form), reveal
 *                                it, put it into hand, then shuffle (CR
 *                                702.31b/c). The library search uses the
 *                                controller's library; this implementation
 *                                moves the first matching land instance to
 *                                hand and shuffles. If no matching land is
 *                                present, the library is still shuffled (CR
 *                                702.31c, last sentence) and no card is
 *                                drawn.
 *       - TYPECYCLING          → search library for a card of the named type,
 *                                reveal it, put it into hand, shuffle (CR
 *                                702.31a). Same library-search semantics as
 *                                Landcycling above.
 *
 * The result is a `KeywordActionResult` carrying the updated state. An
 * `error` is set if any precondition fails; the input `state` is returned
 * unchanged on failure.
 */
export function cycleCard(
  state: GameState,
  playerId: PlayerId,
  cardId: CardInstanceId,
  options: {
    /**
     * Optional pre-selected card instance ID for Typecycling / Landcycling
     * library searches. When supplied, that card is the one found and
     * revealed; when omitted, the engine picks the first card in the library
     * whose type line matches the cycling variant (or any land for the bare
     * Landcycling form).
     */
    selectedFoundCardId?: CardInstanceId;
  } = {},
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

  const info = parseCycling(card.cardData.oracle_text || "");
  if (!info.hasCycling) {
    return {
      success: false,
      state,
      description: "",
      error: `${card.cardData.name} does not have cycling.`,
    };
  }

  // CR 702.30a: cycling is hand-only.
  const handZoneKey = `${playerId}-hand`;
  const handZone = state.zones.get(handZoneKey);
  if (!handZone || !handZone.cardIds.includes(cardId)) {
    return {
      success: false,
      state,
      description: "",
      error: "Cycling can only be activated from your hand.",
    };
  }

  // Sorcery-speed timing (CR 117.1a).
  if (state.status !== "in_progress") {
    return {
      success: false,
      state,
      description: "",
      error: "Cycling can only be activated during an in-progress game.",
    };
  }
  if (state.turn.activePlayerId !== playerId) {
    return {
      success: false,
      state,
      description: "",
      error: "You can cycle only on your turn.",
    };
  }
  if (
    state.turn.currentPhase !== Phase.PRECOMBAT_MAIN &&
    state.turn.currentPhase !== Phase.POSTCOMBAT_MAIN
  ) {
    return {
      success: false,
      state,
      description: "",
      error: "Cycling can only be activated during a main phase.",
    };
  }
  if (state.stack.length > 0) {
    return {
      success: false,
      state,
      description: "",
      error: "Cycling can only be activated when the stack is empty.",
    };
  }
  if (!isPriorityPlayer(state, playerId)) {
    return {
      success: false,
      state,
      description: "",
      error: "You do not have priority.",
    };
  }

  // Pay the cycling mana cost.
  let workingState = state;
  if (info.cost) {
    const payment = {
      generic: info.cost.generic,
      white: info.cost.white,
      blue: info.cost.blue,
      black: info.cost.black,
      red: info.cost.red,
      green: info.cost.green,
      colorless: info.cost.colorless,
    };
    const spend = spendMana(workingState, playerId, payment);
    if (!spend.success) {
      return {
        success: false,
        state,
        description: "",
        error: "Not enough mana to cycle.",
      };
    }
    workingState = spend.state;
  }

  // Pay the discard cost: move the cycled card to the graveyard.
  const discard = moveCardToZone(workingState, cardId, "graveyard");
  if (!discard.success) {
    return {
      success: false,
      state,
      description: "",
      error: discard.error ?? "Failed to discard the cycled card.",
    };
  }
  workingState = discard.state;

  // Resolve the cycling effect based on the variant.
  switch (info.variant) {
    case CyclingVariant.CYCLING: {
      const draw = drawCards(workingState, playerId, 1);
      if (!draw.success) {
        // The discard already happened — surface a clear error so the caller
        // knows to undo. We still return the state with the cycled card in
        // the graveyard (it was paid as a cost) so the caller can decide.
        return {
          success: false,
          state: draw.state,
          description: `Cycled ${card.cardData.name}, but could not draw a card`,
          error: draw.error ?? "Could not draw a card.",
          affectedCards: [cardId],
        };
      }
      return {
        success: true,
        state: draw.state,
        description: `Cycled ${card.cardData.name} and drew a card`,
        affectedCards: [cardId, ...(draw.affectedCards ?? [])],
      };
    }
    case CyclingVariant.TYPECYCLING:
    case CyclingVariant.LANDCYCLING:
    case CyclingVariant.BASIC_LANDCYCLING: {
      const search = searchLibraryForCycling(
        workingState,
        playerId,
        info,
        options.selectedFoundCardId,
      );
      if (!search.success) {
        return {
          success: false,
          state: search.state,
          description: `Cycled ${card.cardData.name}, but library search failed`,
          error: search.error,
          affectedCards: [cardId],
        };
      }
      const moved = search.movedCardId
        ? ` and put ${search.movedCardName ?? "a card"} into hand`
        : "";
      return {
        success: true,
        state: search.state,
        description: `Cycled ${card.cardData.name}${moved}`,
        affectedCards: search.movedCardId
          ? [cardId, search.movedCardId]
          : [cardId],
      };
    }
    default:
      return {
        success: false,
        state: workingState,
        description: "",
        error: `Unknown cycling variant: ${String(info.variant)}`,
        affectedCards: [cardId],
      };
  }
}

/**
 * Internal: library search for Typecycling / Landcycling. Reveals the chosen
 * card, moves it to the controller's hand, and shuffles the library (CR
 * 702.31a-c). The "reveal" step is tracked by adding the revealed card ID to
 * the result; a full implementation would broadcast the reveal to opponents,
 * which is out of scope for the engine API.
 *
 * If `selectedFoundCardId` is supplied, that card is the one moved. Otherwise
 * the engine scans the library (top of the array == bottom of the library)
 * for the first card whose type line matches the cycling variant's predicate.
 * If no match exists, the library is still shuffled (CR 702.31c, "If you
 * don't, shuffle your library.") and no card moves to hand.
 */
function searchLibraryForCycling(
  state: GameState,
  playerId: PlayerId,
  info: CyclingInfo,
  selectedFoundCardId?: CardInstanceId,
): {
  success: boolean;
  state: GameState;
  movedCardId?: CardInstanceId;
  movedCardName?: string;
  error?: string;
} {
  const libraryKey = `${playerId}-library`;
  const handKey = `${playerId}-hand`;
  const library = state.zones.get(libraryKey);
  const hand = state.zones.get(handKey);

  if (!library || !hand) {
    return {
      success: false,
      state,
      error: "Library or hand zone missing.",
    };
  }

  const predicate = buildLibrarySearchPredicate(info);

  // Resolve which card to move. If a selected ID is supplied, validate it is
  // still in the library and matches the predicate. Otherwise pick the first
  // matching card in the library (top of array = bottom of library; the
  // specific position is irrelevant for game-logic correctness here, since
  // the library is going to be shuffled anyway).
  let chosenId: CardInstanceId | null = null;
  if (selectedFoundCardId !== undefined) {
    if (!library.cardIds.includes(selectedFoundCardId)) {
      return {
        success: false,
        state,
        error: "Selected card is not in your library.",
      };
    }
    const chosen = state.cards.get(selectedFoundCardId);
    if (!chosen || !predicate(chosen.cardData)) {
      return {
        success: false,
        state,
        error: "Selected card does not match the cycling variant.",
      };
    }
    chosenId = selectedFoundCardId;
  } else {
    for (const id of library.cardIds) {
      const candidate = state.cards.get(id);
      if (candidate && predicate(candidate.cardData)) {
        chosenId = id;
        break;
      }
    }
  }

  const nextLibrary: Zone = shuffleZone(library);

  if (chosenId === null) {
    // CR 702.31c: even when no matching card is found, the player still
    // shuffles the library. The discard-as-cost already moved the cycled
    // card to the graveyard.
    return {
      success: true,
      state: {
        ...state,
        zones: new Map(state.zones).set(libraryKey, nextLibrary),
        lastModifiedAt: Date.now(),
      },
    };
  }

  // Move the chosen card from library to hand.
  const nextLibraryCardIds = nextLibrary.cardIds.filter(
    (id) => id !== chosenId,
  );
  const movedCard = state.cards.get(chosenId);
  const movedCardName = movedCard?.cardData.name;
  const nextLibrary2: Zone = {
    ...nextLibrary,
    cardIds: nextLibraryCardIds,
  };
  const nextHand: Zone = {
    ...hand,
    cardIds: [...hand.cardIds, chosenId],
  };
  const nextZones = new Map(state.zones);
  nextZones.set(libraryKey, nextLibrary2);
  nextZones.set(handKey, nextHand);

  return {
    success: true,
    state: {
      ...state,
      zones: nextZones,
      lastModifiedAt: Date.now(),
    },
    movedCardId: chosenId,
    movedCardName,
  };
}

/**
 * Build a predicate that matches a card's ScryfallCard data against the
 * cycling variant's search target. Centralises the type-line checks so each
 * search variant shares the same fallback semantics.
 */
function buildLibrarySearchPredicate(
  info: CyclingInfo,
): (cardData: ScryfallCard) => boolean {
  switch (info.variant) {
    case CyclingVariant.TYPECYCLING:
      return (cardData) => {
        const typeLine = (cardData.type_line || "").toLowerCase();
        const wanted = (info.type || "").toLowerCase();
        if (!wanted) return false;
        // Match against the full type line (so "Wizard Subtype" still matches
        // wizardcycling). Allow multi-word types too.
        return typeLine.includes(wanted);
      };
    case CyclingVariant.LANDCYCLING:
      return (cardData) => {
        const typeLine = (cardData.type_line || "").toLowerCase();
        if (info.basicLandType) {
          // "[Type] landcycling" — restrict to lands with that basic subtype.
          const wanted = info.basicLandType.toLowerCase();
          return typeLine.includes("land") && typeLine.includes(wanted);
        }
        // Bare "Landcycling" — any land.
        return typeLine.includes("land");
      };
    case CyclingVariant.BASIC_LANDCYCLING:
      return (cardData) => {
        const typeLine = (cardData.type_line || "").toLowerCase();
        return typeLine.startsWith("basic land");
      };
    default:
      return () => false;
  }
}

/** @deprecated Stub - hand filter not yet implemented */
export function getHandFilterForCard(cardName: string): any {
  return null;
}

// ============================================================================
// Monarchy helpers (CR 704.5p, CR 714)
// Issue #1225.
//
// The monarchy is a designation transferred by a state-based action when the
// current monarch is dealt combat damage by an opponent. Cards such as
// `Regal Behemoth`, `Court of Ambition`, and `Archpriest of Iona` use these
// helpers when their oracle text says "you become the monarch".
//
// We deliberately keep these helpers thin wrappers around the `Player`
// `isMonarch` flag rather than wrapping a separate registry — the rules text
// is the source of truth, and any SBA, triggered ability, or card effect
// resolves through a single channel.
// ============================================================================

