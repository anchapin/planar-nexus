"use client";

import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Hand, Check, X, AlertCircle, Target, Eye, Hash } from "lucide-react";
import Image from "next/image";
import { cn } from "@/lib/utils";
import type { CardState } from "@/types/game";

/**
 * Types for X value selection (variable mana cost spells)
 */

export interface XValueChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string;
  sourceCardName: string;
  minX: number;
  maxX: number;
  onSelect: (value: number) => void;
  onConfirm: (value: number) => void;
  onCancel: () => void;
}

/**
 * X Value Selection Dialog
 * Displays when a player must choose a value for X in a spell's cost/effect
 */
export function XValueChoiceDialog({
  open,
  onOpenChange,
  prompt,
  sourceCardName,
  minX,
  maxX,
  onSelect,
  onConfirm,
  onCancel,
}: XValueChoiceDialogProps) {
  const [selectedValue, setSelectedValue] = React.useState<number | null>(null);

  const canConfirm =
    selectedValue !== null && selectedValue >= minX && selectedValue <= maxX;

  const handleValueClick = (value: number) => {
    setSelectedValue(value);
    onSelect(value);
  };

  const handleConfirm = () => {
    if (selectedValue !== null && canConfirm) {
      onConfirm(selectedValue);
      setSelectedValue(null);
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    setSelectedValue(null);
    onCancel();
    onOpenChange(false);
  };

  React.useEffect(() => {
    if (open) {
      setSelectedValue(null);
    }
  }, [open]);

  const values = React.useMemo(() => {
    const result: number[] = [];
    for (let i = minX; i <= maxX; i++) {
      result.push(i);
    }
    return result;
  }, [minX, maxX]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Hash className="h-5 w-5 text-primary" />
            {sourceCardName}
          </DialogTitle>
          <DialogDescription className="text-base">{prompt}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>Select a value for X</span>
          </div>

          <div className="grid grid-cols-5 gap-2">
            {values.map((value) => {
              const isSelected = selectedValue === value;
              return (
                <button
                  key={value}
                  onClick={() => handleValueClick(value)}
                  className={cn(
                    "h-12 rounded-lg text-lg font-bold transition-all",
                    isSelected
                      ? "bg-primary text-primary-foreground ring-2 ring-primary ring-offset-2"
                      : "bg-muted hover:bg-muted/80 text-foreground",
                  )}
                >
                  {value}
                </button>
              );
            })}
          </div>

          {selectedValue !== null && (
            <div className="bg-primary/10 rounded-lg p-3">
              <p className="text-sm font-medium text-primary">
                Selected: X = {selectedValue}
              </p>
            </div>
          )}

          <div className="text-xs text-muted-foreground text-center">
            Valid range: {minX} to {maxX}
          </div>
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="outline" onClick={handleCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            <Check className="h-4 w-4 mr-1" />
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook for managing X value choice dialogs
 */
export function useXValueChoiceDialog() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [pendingChoice, setPendingChoice] = React.useState<{
    prompt: string;
    sourceCardName: string;
    minX: number;
    maxX: number;
    stackObjectId: string;
    onSelect?: (value: number) => void;
    onConfirm?: (value: number) => void;
    onCancel?: () => void;
  } | null>(null);

  const showChoice = React.useCallback((config: typeof pendingChoice) => {
    setPendingChoice(config);
    setIsOpen(true);
  }, []);

  const handleConfirm = React.useCallback(
    (value: number) => {
      pendingChoice?.onConfirm?.(value);
      setIsOpen(false);
      setPendingChoice(null);
    },
    [pendingChoice],
  );

  const handleCancel = React.useCallback(() => {
    pendingChoice?.onCancel?.();
    setIsOpen(false);
    setPendingChoice(null);
  }, [pendingChoice]);

  const handleSelect = React.useCallback(
    (value: number) => {
      pendingChoice?.onSelect?.(value);
    },
    [pendingChoice],
  );

  const close = React.useCallback(() => {
    setIsOpen(false);
    setPendingChoice(null);
  }, []);

  return {
    isOpen,
    setIsOpen,
    pendingChoice,
    showChoice,
    handleConfirm,
    handleCancel,
    handleSelect,
    close,
    XValueChoiceDialog: pendingChoice ? (
      <XValueChoiceDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        prompt={pendingChoice.prompt}
        sourceCardName={pendingChoice.sourceCardName}
        minX={pendingChoice.minX}
        maxX={pendingChoice.maxX}
        onSelect={handleSelect}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    ) : null,
  };
}

/**
 * Types for card choice dialogs (Duress, Thoughtseize, etc.)
 */

export interface CardChoiceOption {
  id: string;
  label: string;
  isValid: boolean;
  card?: CardState;
}

export interface CardChoiceDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog closes */
  onOpenChange: (open: boolean) => void;
  /** Prompt text to display */
  prompt: string;
  /** Cards in opponent's hand to choose from */
  opponentHand: CardState[];
  /** Valid card IDs that can be selected */
  validTargetIds: string[];
  /** Minimum choices required */
  minChoices: number;
  /** Maximum choices allowed */
  maxChoices: number;
  /** Source card name (e.g., "Duress") */
  sourceCardName: string;
  /** Player names for display */
  playerNames?: { castingPlayer: string; targetPlayer: string };
  /** Callback when a card is selected */
  onSelect: (cardId: string) => void;
  /** Callback when choice is confirmed */
  onConfirm: (cardId: string) => void;
  /** Callback when choice is cancelled */
  onCancel: () => void;
}

/**
 * Card Choice Dialog Component
 * Displays when player must select a card from opponent's hand (Duress, Thoughtseize, etc.)
 */
export function CardChoiceDialog({
  open,
  onOpenChange,
  prompt,
  opponentHand,
  validTargetIds,
  minChoices,
  maxChoices,
  sourceCardName,
  playerNames,
  onSelect,
  onConfirm,
  onCancel,
}: CardChoiceDialogProps) {
  const [selectedCardId, setSelectedCardId] = React.useState<string | null>(
    null,
  );

  const validTargetSet = React.useMemo(
    () => new Set(validTargetIds),
    [validTargetIds],
  );

  const canConfirm =
    selectedCardId !== null && validTargetSet.has(selectedCardId);

  const handleCardClick = (cardId: string) => {
    if (!validTargetSet.has(cardId)) return;

    if (selectedCardId === cardId) {
      setSelectedCardId(null);
    } else {
      setSelectedCardId(cardId);
      onSelect(cardId);
    }
  };

  const handleConfirm = () => {
    if (selectedCardId && canConfirm) {
      onConfirm(selectedCardId);
      setSelectedCardId(null);
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    setSelectedCardId(null);
    onCancel();
    onOpenChange(false);
  };

  React.useEffect(() => {
    if (open) {
      setSelectedCardId(null);
    }
  }, [open]);

  const getCardImage = (card: CardState) => {
    if (card.card.image_uris?.normal) {
      return card.card.image_uris.normal;
    }
    if (card.card.image_uris?.small) {
      return card.card.image_uris.small;
    }
    return null;
  };

  const renderCard = (card: CardState) => {
    const isValid = validTargetSet.has(card.id);
    const isSelected = selectedCardId === card.id;
    const imageUrl = getCardImage(card);

    return (
      <div
        key={card.id}
        className={cn(
          "relative rounded-lg overflow-hidden border-2 transition-all cursor-pointer",
          isValid
            ? "border-primary hover:border-primary/70 hover:scale-105"
            : "border-muted opacity-60 cursor-not-allowed",
          isSelected && isValid && "ring-4 ring-primary ring-offset-2",
        )}
        onClick={() => handleCardClick(card.id)}
      >
        {imageUrl ? (
          <div className="aspect-[5/7] relative">
            <Image
              src={imageUrl}
              alt={card.card.name}
              fill
              className="object-cover"
              sizes="120px"
            />
          </div>
        ) : (
          <div className="aspect-[5/7] bg-muted flex items-center justify-center">
            <span className="text-xs text-muted-foreground text-center p-2">
              {card.card.name}
            </span>
          </div>
        )}

        {isSelected && isValid && (
          <div className="absolute inset-0 bg-primary/20 flex items-center justify-center">
            <div className="bg-primary text-primary-foreground rounded-full p-2">
              <Check className="h-6 w-6" />
            </div>
          </div>
        )}

        {!isValid && (
          <div className="absolute inset-0 bg-muted/80 flex items-center justify-center">
            <Badge variant="secondary" className="text-xs">
              Not targetable
            </Badge>
          </div>
        )}

        <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2">
          <p className="text-white text-xs font-medium truncate">
            {card.card.name}
          </p>
          <p className="text-white/70 text-[10px] truncate">
            {card.card.type_line}
          </p>
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5 text-primary" />
            {sourceCardName}
          </DialogTitle>
          <DialogDescription className="text-base">{prompt}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden">
          {playerNames && (
            <div className="flex items-center justify-center gap-4 text-sm">
              <Badge variant="outline">
                <Target className="h-3 w-3 mr-1" />
                Target: {playerNames.targetPlayer}&apos;s hand
              </Badge>
            </div>
          )}

          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Hand className="h-4 w-4" />
            <span>Click a card to select it for discard</span>
          </div>

          <Separator />

          <div className="bg-muted/30 rounded-lg p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium">
                {playerNames?.targetPlayer || "Opponent"}&apos;s Hand
              </span>
              <Badge variant="secondary">
                {opponentHand.length} card{opponentHand.length !== 1 ? "s" : ""}
              </Badge>
            </div>

            <ScrollArea className="h-[280px]">
              <div className="grid grid-cols-4 gap-3">
                {opponentHand.map((card) => renderCard(card))}
              </div>
            </ScrollArea>
          </div>

          {validTargetIds.length === 0 && (
            <div className="flex items-center gap-2 text-amber-600 dark:text-amber-400 bg-amber-500/10 rounded-lg p-4">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              <p className="text-sm">
                No valid targets in opponent&apos;s hand. You must still
                confirm.
              </p>
            </div>
          )}

          {selectedCardId && validTargetSet.has(selectedCardId) && (
            <div className="bg-primary/10 rounded-lg p-3">
              <p className="text-sm font-medium text-primary">
                Selected:{" "}
                {opponentHand.find((c) => c.id === selectedCardId)?.card.name}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="outline" onClick={handleCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            <Check className="h-4 w-4 mr-1" />
            Confirm Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook for managing card choice dialogs
 */
export function useCardChoiceDialog() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [pendingChoice, setPendingChoice] = React.useState<{
    prompt: string;
    opponentHand: CardState[];
    validTargetIds: string[];
    minChoices: number;
    maxChoices: number;
    sourceCardName: string;
    playerNames?: { castingPlayer: string; targetPlayer: string };
    onSelect?: (cardId: string) => void;
    onConfirm?: (cardId: string) => void;
    onCancel?: () => void;
  } | null>(null);

  const showChoice = React.useCallback((config: typeof pendingChoice) => {
    setPendingChoice(config);
    setIsOpen(true);
  }, []);

  const handleConfirm = React.useCallback(
    (cardId: string) => {
      pendingChoice?.onConfirm?.(cardId);
      setIsOpen(false);
      setPendingChoice(null);
    },
    [pendingChoice],
  );

  const handleCancel = React.useCallback(() => {
    pendingChoice?.onCancel?.();
    setIsOpen(false);
    setPendingChoice(null);
  }, [pendingChoice]);

  const handleSelect = React.useCallback(
    (cardId: string) => {
      pendingChoice?.onSelect?.(cardId);
    },
    [pendingChoice],
  );

  const close = React.useCallback(() => {
    setIsOpen(false);
    setPendingChoice(null);
  }, []);

  return {
    isOpen,
    setIsOpen,
    pendingChoice,
    showChoice,
    handleConfirm,
    handleCancel,
    handleSelect,
    close,
    CardChoiceDialog: pendingChoice ? (
      <CardChoiceDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        prompt={pendingChoice.prompt}
        opponentHand={pendingChoice.opponentHand}
        validTargetIds={pendingChoice.validTargetIds}
        minChoices={pendingChoice.minChoices}
        maxChoices={pendingChoice.maxChoices}
        sourceCardName={pendingChoice.sourceCardName}
        playerNames={pendingChoice.playerNames}
        onSelect={handleSelect}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    ) : null,
  };
}

export default CardChoiceDialog;

// ============================================================================
// Mode Choice Dialog (Modal Spells)
// ============================================================================

export interface ModeChoiceOption {
  label: string;
  value: string | number;
  isValid: boolean;
}

export interface ModeChoiceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  prompt: string;
  sourceCardName: string;
  modes: ModeChoiceOption[];
  minChoices: number;
  maxChoices: number;
  onSelect: (modeValue: string | number) => void;
  onConfirm: (modeValue: string | number) => void;
  onCancel: () => void;
}

export function ModeChoiceDialog({
  open,
  onOpenChange,
  prompt,
  sourceCardName,
  modes,
  minChoices,
  maxChoices,
  onSelect,
  onConfirm,
  onCancel,
}: ModeChoiceDialogProps) {
  const [selectedMode, setSelectedMode] = React.useState<
    string | number | null
  >(null);

  const canConfirm =
    selectedMode !== null &&
    modes.some((m) => m.value === selectedMode && m.isValid);

  const handleModeClick = (mode: ModeChoiceOption) => {
    if (!mode.isValid) return;
    setSelectedMode(mode.value);
    onSelect(mode.value);
  };

  const handleConfirm = () => {
    if (selectedMode !== null && canConfirm) {
      onConfirm(selectedMode);
      setSelectedMode(null);
      onOpenChange(false);
    }
  };

  const handleCancel = () => {
    setSelectedMode(null);
    onCancel();
    onOpenChange(false);
  };

  React.useEffect(() => {
    if (open) {
      setSelectedMode(null);
    }
  }, [open]);

  const selectedModeData = modes.find((m) => m.value === selectedMode);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Target className="h-5 w-5 text-primary" />
            {sourceCardName}
          </DialogTitle>
          <DialogDescription className="text-base">{prompt}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
            <AlertCircle className="h-4 w-4" />
            <span>
              Choose a mode (
              {minChoices === maxChoices
                ? minChoices
                : `${minChoices}-${maxChoices}`}
              )
            </span>
          </div>

          <div className="space-y-2">
            {modes.map((mode, index) => {
              const isSelected = selectedMode === mode.value;
              return (
                <button
                  key={index}
                  onClick={() => handleModeClick(mode)}
                  disabled={!mode.isValid}
                  className={cn(
                    "w-full p-4 rounded-lg text-left transition-all",
                    mode.isValid
                      ? "border-2 border-border hover:border-primary/70 hover:bg-primary/5 cursor-pointer"
                      : "border border-muted opacity-50 cursor-not-allowed bg-muted/30",
                    isSelected &&
                      mode.isValid &&
                      "border-primary bg-primary/10 ring-2 ring-primary ring-offset-2",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div
                      className={cn(
                        "w-6 h-6 rounded-full border-2 flex items-center justify-center flex-shrink-0 mt-0.5",
                        isSelected && mode.isValid
                          ? "bg-primary border-primary text-primary-foreground"
                          : "border-muted-foreground/30",
                      )}
                    >
                      {isSelected && mode.isValid && (
                        <Check className="h-4 w-4" />
                      )}
                    </div>
                    <span
                      className={cn(
                        "text-sm",
                        !mode.isValid && "text-muted-foreground",
                      )}
                    >
                      {mode.label}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>

          {selectedModeData && (
            <div className="bg-primary/10 rounded-lg p-3">
              <p className="text-sm font-medium text-primary">
                Selected: {selectedModeData.label}
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="outline" onClick={handleCancel}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm}>
            <Check className="h-4 w-4 mr-1" />
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function useModeChoiceDialog() {
  const [isOpen, setIsOpen] = React.useState(false);
  const [pendingChoice, setPendingChoice] = React.useState<{
    prompt: string;
    sourceCardName: string;
    modes: ModeChoiceOption[];
    minChoices: number;
    maxChoices: number;
    stackObjectId: string;
    onSelect?: (modeValue: string | number) => void;
    onConfirm?: (modeValue: string | number) => void;
    onCancel?: () => void;
  } | null>(null);

  const showChoice = React.useCallback((config: typeof pendingChoice) => {
    setPendingChoice(config);
    setIsOpen(true);
  }, []);

  const handleConfirm = React.useCallback(
    (modeValue: string | number) => {
      pendingChoice?.onConfirm?.(modeValue);
      setIsOpen(false);
      setPendingChoice(null);
    },
    [pendingChoice],
  );

  const handleCancel = React.useCallback(() => {
    pendingChoice?.onCancel?.();
    setIsOpen(false);
    setPendingChoice(null);
  }, [pendingChoice]);

  const handleSelect = React.useCallback(
    (modeValue: string | number) => {
      pendingChoice?.onSelect?.(modeValue);
    },
    [pendingChoice],
  );

  const close = React.useCallback(() => {
    setIsOpen(false);
    setPendingChoice(null);
  }, []);

  return {
    isOpen,
    setIsOpen,
    pendingChoice,
    showChoice,
    handleConfirm,
    handleCancel,
    handleSelect,
    close,
    ModeChoiceDialog: pendingChoice ? (
      <ModeChoiceDialog
        open={isOpen}
        onOpenChange={setIsOpen}
        prompt={pendingChoice.prompt}
        sourceCardName={pendingChoice.sourceCardName}
        modes={pendingChoice.modes}
        minChoices={pendingChoice.minChoices}
        maxChoices={pendingChoice.maxChoices}
        onSelect={handleSelect}
        onConfirm={handleConfirm}
        onCancel={handleCancel}
      />
    ) : null,
  };
}
