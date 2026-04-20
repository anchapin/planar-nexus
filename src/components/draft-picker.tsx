/**
 * Draft Picker Component
 *
 * Handles the card picking logic during drafting.
 * DRFT-04: Add picked card to pool, advance to next pick
 *
 * Phase 15: Draft Core
 */

import { useCallback } from "react";
import { DraftPackView } from "./draft-pack-view";
import type {
  DraftSession,
  DraftPack,
  PoolCard,
} from "@/lib/limited/types";

// ============================================================================
// Types
// ============================================================================

export interface DraftPickerProps {
  /** Current draft session */
  session: DraftSession;
  /** Called when user picks a card */
  onPickCard: (cardId: string) => void;
  /** Called when user hovers over a card (DRFT-08) */
  onHoverCard: (cardId: string | null) => void;
  /** Called when user opens a pack */
  onOpenPack: () => void;
  /** Optional className */
  className?: string;
}

// ============================================================================
// Component
// ============================================================================

/**
 * DraftPicker - Coordinates pack view and handles pick logic
 *
 * Renders the current pack and delegates UI to DraftPackView
 * Pick logic is handled by the parent component
 */
export function DraftPicker({
  session,
  onPickCard,
  onHoverCard,
  onOpenPack,
  className,
}: DraftPickerProps) {
  // Get current pack
  const currentPack = session.packs[session.currentPackIndex];

  if (!currentPack) {
    return null;
  }

  return (
    <DraftPackView
      pack={currentPack}
      currentPickIndex={session.currentPickIndex}
      onCardClick={onPickCard}
      onCardHover={onHoverCard}
      onOpenPack={onOpenPack}
      className={className}
    />
  );
}

// ============================================================================
// Pick Logic (Exported Functions)
// ============================================================================

/**
 * Pick a card from the current pack
 *
 * DRFT-04: Add picked card to pool, advance pick index
 *
 * @param session - Current draft session
 * @param cardId - ID of card to pick
 * @returns Updated session with card added to pool
 */
export function pickCard(
  session: DraftSession,
  cardId: string
): DraftSession {
  const currentPack = session.packs[session.currentPackIndex];
  if (!currentPack) {
    return session;
  }

  // Find the card
  const card = currentPack.cards.find((c) => c.id === cardId);
  if (!card) {
    return session;
  }

  // Don't allow picking the same card twice
  if (currentPack.pickedCardIds.includes(cardId)) {
    return session;
  }

  // Create pool card from draft card
  const poolCard: PoolCard = {
    ...card,
    addedAt: new Date().toISOString(),
  };

  // Update pack with picked card
  const updatedPack: DraftPack = {
    ...currentPack,
    pickedCardIds: [...currentPack.pickedCardIds, cardId],
  };

  // Calculate next state
  let nextPickIndex = session.currentPickIndex + 1;
  let nextPackIndex = session.currentPackIndex;
  let nextDraftState: DraftSession["draftState"] = "picking";

  // Check if pack is complete (14 picks)
  if (nextPickIndex >= 14) {
    // Move to next pack
    nextPickIndex = 0;
    if (nextPackIndex >= 2) {
      // Draft complete
      nextDraftState = "draft_complete";
    } else {
      // Move to next pack
      nextPackIndex++;
      nextDraftState = "pack_complete";
    }
  }

  // Build updated packs array
  const updatedPacks = session.packs.map((p, i) =>
    i === session.currentPackIndex ? updatedPack : p
  );

  return {
    ...session,
    pool: [...session.pool, poolCard],
    packs: updatedPacks,
    currentPackIndex: nextPackIndex,
    currentPickIndex: nextPickIndex,
    draftState: nextDraftState,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Open the current pack (reveal cards)
 *
 * DRFT-03: Cards face-down until user opens pack
 *
 * @param session - Current draft session
 * @returns Updated session with pack opened
 */
export function openCurrentPack(session: DraftSession): DraftSession {
  const currentPack = session.packs[session.currentPackIndex];
  if (!currentPack || currentPack.isOpened) {
    return session;
  }

  const updatedPack: DraftPack = {
    ...currentPack,
    isOpened: true,
  };

  const updatedPacks = session.packs.map((p, i) =>
    i === session.currentPackIndex ? updatedPack : p
  );

  return {
    ...session,
    packs: updatedPacks,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Advance from pack_complete to picking state
 *
 * @param session - Current draft session
 * @returns Updated session in picking state
 */
export function advanceToNextPack(session: DraftSession): DraftSession {
  if (session.draftState !== "pack_complete") {
    return session;
  }

  // Open the next pack
  const nextPack = session.packs[session.currentPackIndex];
  if (!nextPack) {
    return session;
  }

  const updatedPack: DraftPack = {
    ...nextPack,
    isOpened: true,
  };

  const updatedPacks = session.packs.map((p, i) =>
    i === session.currentPackIndex ? updatedPack : p
  );

  return {
    ...session,
    packs: updatedPacks,
    draftState: "picking",
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Handle hover tracking for auto-pick
 *
 * DRFT-08: Track hovered card for potential auto-pick
 *
 * @param session - Current draft session
 * @param cardId - Card being hovered (or null if leaving)
 * @returns Updated session with lastHoveredCardId
 */
export function trackHover(
  session: DraftSession,
  cardId: string | null
): DraftSession {
  return {
    ...session,
    lastHoveredCardId: cardId,
  };
}

// ============================================================================
// Hook: useDraftPicker
// ============================================================================

/**
 * Hook for draft picking logic
 *
 * @param session - Draft session state
 * @param setSession - Function to update session
 * @returns Pick handlers and derived state
 */
export function useDraftPicker(
  session: DraftSession | null,
  setSession: (session: DraftSession) => void
) {
  // Pick a card
  const handlePickCard = useCallback(
    (cardId: string) => {
      if (!session) return;
      setSession(pickCard(session, cardId));
    },
    [session, setSession]
  );

  // Open current pack
  const handleOpenPack = useCallback(() => {
    if (!session) return;
    setSession(openCurrentPack(session));
  }, [session, setSession]);

  // Track hover
  const handleHoverCard = useCallback(
    (cardId: string | null) => {
      if (!session) return;
      setSession(trackHover(session, cardId));
    },
    [session, setSession]
  );

  // Advance to next pack
  const handleAdvanceToNextPack = useCallback(() => {
    if (!session) return;
    setSession(advanceToNextPack(session));
  }, [session, setSession]);

  return {
    handlePickCard,
    handleOpenPack,
    handleHoverCard,
    handleAdvanceToNextPack,
  };
}

// ============================================================================
// Exports
// ============================================================================
