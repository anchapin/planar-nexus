"use client";

import { useState, useCallback, useRef } from "react";
import {
  CardInteractionType,
  InteractionContext,
  ClickHandlerResult,
  TargetingState,
  SelectedTarget,
} from "@/types/card-interactions";
import { CardInstanceId, PlayerId } from "@/lib/game-state/types";

interface UseCardInteractionsProps {
  onCardInspect?: (cardId: CardInstanceId) => void;
  onCardTap?: (cardId: CardInstanceId) => void;
  onAbilityActivate?: (cardId: CardInstanceId, abilityIndex: number) => void;
  onTargetSelect?: (targetId: string, targetType: "card" | "player") => void;
  /** Called when targeting is complete and confirmed */
  onTargetConfirm?: (targets: SelectedTarget[]) => void;
  /** Called when targeting is cancelled */
  onTargetCancel?: () => void;
}

const DOUBLE_CLICK_TIMEOUT = 400;

/**
 * Hook for handling card interactions on the battlefield
 * Implements click-to-act interface (issue #25)
 */
export function useCardInteractions(props: UseCardInteractionsProps = {}) {
  // Interaction state
  const [interactionContext, setInteractionContext] = useState<InteractionContext | null>(null);
  const [selectedCardId, setSelectedCardId] = useState<CardInstanceId | null>(null);
  const [targetingState, setTargetingState] = useState<TargetingState>({
    isActive: false,
    sourceCardId: null,
    sourceAbilityId: null,
    selectedTargets: [],
    maxTargets: 1,
    minTargets: 1,
    validTargetTypes: [],
    canTargetPlayer: false,
  });

  // Track clicks for single/double click detection
  const lastClickTime = useRef<number>(0);
  const lastClickCardId = useRef<CardInstanceId | null>(null);

  /**
   * Handle single click on a card
   * - Select card for targeting if targeting is active
   * - Show card inspection otherwise
   */
  const handleSingleClick = useCallback(
    (cardId: CardInstanceId): ClickHandlerResult => {
      // If in targeting mode, select this card as target
      if (targetingState.isActive) {
        return handleTargetSelection(cardId, "card");
      }

      // Otherwise, inspect the card
      setSelectedCardId(cardId);
      props.onCardInspect?.(cardId);

      return {
        action: "inspect",
        cardId,
        message: "Card selected for inspection",
      };
    },
    [targetingState.isActive, props]
  );

  /**
   * Handle double click on a card
   * - Tap/untap the card if it's a permanent on the battlefield
   */
  const handleDoubleClick = useCallback(
    (cardId: CardInstanceId): ClickHandlerResult => {
      // Tap/untap the card
      props.onCardTap?.(cardId);

      return {
        action: targetingState.isActive ? "select_for_targeting" : "tap",
        cardId,
        message: targetingState.isActive
          ? "Card selected for targeting"
          : "Card tapped/untapped",
      };
    },
    [props, targetingState.isActive]
  );

  /**
   * Handle card click with automatic single/double click detection
   */
  const handleCardClick = useCallback(
    (cardId: CardInstanceId): ClickHandlerResult => {
      const now = Date.now();
      const timeSinceLastClick = now - lastClickTime.current;
      const isSameCard = lastClickCardId.current === cardId;

      // Reset if too much time has passed or different card
      if (timeSinceLastClick > DOUBLE_CLICK_TIMEOUT || !isSameCard) {
        lastClickTime.current = now;
        lastClickCardId.current = cardId;
        return handleSingleClick(cardId);
      }

      // Double click detected
      lastClickTime.current = 0;
      lastClickCardId.current = null;
      return handleDoubleClick(cardId);
    },
    [handleSingleClick, handleDoubleClick]
  );

  /**
   * Handle right-click for context menu
   */
  const handleRightClick = useCallback(
    (cardId: CardInstanceId, event: React.MouseEvent) => {
      event.preventDefault();
      event.stopPropagation();

      // For now, just select the card - context menu would be shown by the UI
      setSelectedCardId(cardId);

      return {
        action: "view_details" as CardInteractionType,
        cardId,
        message: "Context menu opened",
      };
    },
    []
  );

  /**
   * Start targeting mode for an ability
   */
  const startTargeting = useCallback(
    (
      sourceCardId: CardInstanceId,
      abilityId?: string,
      options?: {
        maxTargets?: number;
        minTargets?: number;
        validTargetTypes?: string[];
        canTargetPlayer?: boolean;
      }
    ) => {
      setTargetingState({
        isActive: true,
        sourceCardId,
        sourceAbilityId: abilityId ?? null,
        selectedTargets: [],
        maxTargets: options?.maxTargets ?? 1,
        minTargets: options?.minTargets ?? 1,
        validTargetTypes: options?.validTargetTypes ?? [],
        canTargetPlayer: options?.canTargetPlayer ?? false,
      });

      setInteractionContext({
        type: "select_for_targeting",
        sourceCardId,
        sourceAbilityId: abilityId ?? undefined,
        isActive: true,
      });
    },
    []
  );

  /**
   * Handle target selection
   */
  const handleTargetSelection = useCallback(
    (targetId: string, targetType: "card" | "player"): ClickHandlerResult => {
      if (!targetingState.isActive) {
        return {
          action: "select_for_targeting",
          message: "Not in targeting mode",
        };
      }

      // Check if we can add more targets
      if (targetingState.selectedTargets.length >= targetingState.maxTargets) {
        return {
          action: "select_for_targeting",
          message: `Maximum ${targetingState.maxTargets} targets allowed`,
        };
      }

      // Check if already selected
      const alreadySelected = targetingState.selectedTargets.some(
        (t) => t.targetId === targetId
      );
      if (alreadySelected) {
        // Deselect
        const newTargets = targetingState.selectedTargets.filter(
          (t) => t.targetId !== targetId
        );
        setTargetingState({
          ...targetingState,
          selectedTargets: newTargets,
        });
        return {
          action: "select_for_targeting",
          message: "Target deselected",
        };
      }

      // Add target
      const newTarget: SelectedTarget = {
        targetId,
        targetType,
        playerId: targetType === "player" ? (targetId as PlayerId) : undefined,
      };
      const newTargets = [...targetingState.selectedTargets, newTarget];

      setTargetingState({
        ...targetingState,
        selectedTargets: newTargets,
      });

      props.onTargetSelect?.(targetId, targetType);

      return {
        action: "select_for_targeting",
        message: `Target selected (${newTargets.length}/${targetingState.maxTargets})`,
      };
    },
    [targetingState, props]
  );

  /**
   * Confirm target selection
   */
  const confirmTargets = useCallback(() => {
    if (!targetingState.isActive) return;

    // Check minimum targets
    if (targetingState.selectedTargets.length < targetingState.minTargets) {
      return;
    }

    props.onTargetConfirm?.(targetingState.selectedTargets);

    // Clear targeting state
    setTargetingState({
      isActive: false,
      sourceCardId: null,
      sourceAbilityId: null,
      selectedTargets: [],
      maxTargets: 1,
      minTargets: 1,
      validTargetTypes: [],
      canTargetPlayer: false,
    });
    setInteractionContext(null);
  }, [targetingState, props]);

  /**
   * Cancel targeting mode
   */
  const cancelTargeting = useCallback(() => {
    props.onTargetCancel?.();

    setTargetingState({
      isActive: false,
      sourceCardId: null,
      sourceAbilityId: null,
      selectedTargets: [],
      maxTargets: 1,
      minTargets: 1,
      validTargetTypes: [],
      canTargetPlayer: false,
    });
    setInteractionContext(null);
  }, [props]);

  /**
   * Check if a card is a valid target
   */
  const isValidTarget = useCallback(
    (cardId: string, cardTypes: string[]): boolean => {
      if (!targetingState.isActive) return false;
      if (targetingState.validTargetTypes.length === 0) return true;

      return cardTypes.some((type) =>
        targetingState.validTargetTypes.includes(type.toLowerCase())
      );
    },
    [targetingState]
  );

  /**
   * Clear selection
   */
  const clearSelection = useCallback(() => {
    setSelectedCardId(null);
  }, []);

  return {
    // State
    interactionContext,
    selectedCardId,
    targetingState,

    // Click handlers
    handleCardClick,
    handleRightClick,
    handleSingleClick,
    handleDoubleClick,

    // Targeting
    startTargeting,
    handleTargetSelection,
    confirmTargets,
    cancelTargeting,
    isValidTarget,

    // Selection
    clearSelection,
  };
}
