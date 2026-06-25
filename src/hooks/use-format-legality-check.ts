/**
 * @fileOverview Real-time format legality validation for the deck builder.
 *
 * Validates each card in a deck against a target format using the card's
 * `legalities` record (Scryfall-style: 'legal' | 'not_legal' | 'banned' |
 * 'restricted'). Returns per-card status plus a roll-up summary that the
 * deck builder UI uses for badges, add-blocking, and the stats panel.
 */

import { useMemo } from "react";
import type { DeckCard } from "@/app/actions";
import type { Format } from "@/lib/game-rules";

/**
 * Per-card legality status, normalised for UI consumption.
 * - `legal`      — explicitly allowed in the format
 * - `restricted` — legal but limited to a single copy (Vintage-style)
 * - `banned`     — explicitly banned; must not be playable
 * - `not_legal`  — card is not part of the format's pool
 */
export type CardLegalityStatus =
  | "legal"
  | "restricted"
  | "banned"
  | "not_legal";

export interface CardLegalityResult {
  /** The card id being described. */
  cardId: string;
  /** Normalised status for badge rendering. */
  status: CardLegalityStatus;
  /** Raw value from `card.legalities[format]`, or undefined if missing. */
  rawLegality: string | undefined;
  /** True when the card may not be added to / kept in the deck. */
  isIllegal: boolean;
  /** Human-readable reason, suitable for toasts and tooltips. */
  reason: string;
}

export interface DeckLegalitySummary {
  /** Per-card results keyed by card id. */
  cards: Map<string, CardLegalityResult>;
  /** Number of cards (by copy count) legal in the format. */
  legalCardCount: number;
  /** Number of cards (by copy count) illegal in the format. */
  illegalCardCount: number;
  /** Distinct illegal card names for surfacing in summaries. */
  illegalCardNames: string[];
  /** Distinct banned card names — the most severe class. */
  bannedCardNames: string[];
  /** True when every card in the deck is legal. */
  isDeckLegal: boolean;
}

/**
 * Normalise a raw Scryfall legality string into our UI status. Cards with
 * missing/unknown legality data are treated as `not_legal` so that we err
 * on the side of warning the user rather than silently allowing unknown
 * cards into a competitive deck.
 */
export function normaliseLegality(
  raw: string | undefined,
): CardLegalityStatus {
  switch (raw) {
    case "legal":
      return "legal";
    case "restricted":
      return "restricted";
    case "banned":
      return "banned";
    default:
      // Includes 'not_legal' and any undefined / unexpected value.
      return "not_legal";
  }
}

/**
 * Build a human-readable reason for a card legality status. Uses the
 * provided format label so messages stay consistent with the rest of the UI.
 */
export function describeLegality(
  status: CardLegalityStatus,
  cardName: string,
  formatLabel: string,
): string {
  switch (status) {
    case "legal":
      return `"${cardName}" is legal in ${formatLabel}.`;
    case "restricted":
      return `"${cardName}" is restricted in ${formatLabel} (maximum 1 copy).`;
    case "banned":
      return `"${cardName}" is banned in ${formatLabel}.`;
    case "not_legal":
    default:
      return `"${cardName}" is not legal in ${formatLabel}.`;
  }
}

/**
 * Inspect a single card's legality record for a target format. Pure function
 * exposed for reuse by the card-search filter and unit tests.
 */
export function checkCardLegality(
  card: { id: string; name: string; legalities?: Record<string, string> },
  format: Format,
  formatLabel?: string,
): CardLegalityResult {
  const raw = card.legalities?.[format];
  const status = normaliseLegality(raw);
  const isIllegal = status !== "legal" && status !== "restricted";
  return {
    cardId: card.id,
    status,
    rawLegality: raw,
    isIllegal,
    reason: describeLegality(status, card.name, formatLabel ?? format),
  };
}

/**
 * Validate an entire deck against a target format. Memoised for use inside
 * deck builder components that re-render on every card change.
 */
export function useFormatLegalityCheck(
  deck: DeckCard[],
  format: Format,
  formatLabel?: string,
): DeckLegalitySummary {
  return useMemo(() => {
    const label = formatLabel ?? format;
    const cards = new Map<string, CardLegalityResult>();
    let legalCardCount = 0;
    let illegalCardCount = 0;
    const illegalCardNames: string[] = [];
    const bannedCardNames: string[] = [];

    for (const card of deck) {
      // Avoid clobbering an existing entry when two distinct printings share
      // an id — last write wins, matching how the deck list dedupes.
      const result = checkCardLegality(card, format, label);
      cards.set(card.id, result);

      if (result.isIllegal) {
        illegalCardCount += card.count;
        illegalCardNames.push(card.name);
        if (result.status === "banned") {
          bannedCardNames.push(card.name);
        }
      } else {
        legalCardCount += card.count;
      }
    }

    return {
      cards,
      legalCardCount,
      illegalCardCount,
      illegalCardNames,
      bannedCardNames,
      isDeckLegal: illegalCardCount === 0,
    };
  }, [deck, format, formatLabel]);
}
