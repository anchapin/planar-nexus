"use client";

import type { CardState, ZoneType } from "@/types/game";
import {
  BattlefieldCard,
  VirtualizedZoneStrip,
} from "@/components/virtualized-zone-strip";

// Re-export so existing imports (`BattlefieldCard` from this module) keep
// working — game-board.tsx and the legacy test both pull it from here.
export { BattlefieldCard };

export interface VirtualizedBattlefieldProps {
  cards: CardState[];
  zone: ZoneType;
  onCardClick?: (cardId: string, zone: ZoneType) => void;
  /** Class applied to the scroll container (e.g. absolute fill / height). */
  className?: string;
  /** Estimated card width in px (cards are ~40-56px wide). */
  estimateSize?: number;
  /** Horizontal gap between cards in px (mirrors Tailwind `gap-1` = 4px). */
  gap?: number;
  /** Number of cards rendered outside the visible window on each side. */
  overscan?: number;
}

/**
 * Horizontally-windowed battlefield permanent strip (#1082).
 *
 * Now a thin wrapper around the generalized `VirtualizedZoneStrip` (#1390),
 * pinned to `orientation="horizontal"` so the battlefield row layout and the
 * existing tests are unchanged. See `virtualized-zone-strip.tsx` for the
 * full implementation and the per-zone threshold table.
 */
export function VirtualizedBattlefield(
  props: VirtualizedBattlefieldProps,
) {
  return <VirtualizedZoneStrip orientation="horizontal" {...props} />;
}
