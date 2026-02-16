"use client";

import * as React from "react";
import { TargetingState, SelectedTarget } from "@/types/card-interactions";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Crosshair,
  Check,
  X,
  AlertCircle,
  Target,
  User,
  Users,
} from "lucide-react";

interface TargetingOverlayProps {
  /** Current targeting state */
  targetingState: TargetingState;
  /** Source card name for display */
  sourceCardName?: string;
  /** Source ability name for display */
  sourceAbilityName?: string;
  /** Callback when target is selected */
  onTargetSelect: (targetId: string, targetType: "card" | "player") => void;
  /** Callback when targets are confirmed */
  onConfirm: () => void;
  /** Callback when targeting is cancelled */
  onCancel: () => void;
  /** Function to check if a card is a valid target */
  isValidTarget?: (cardId: string, cardTypes: string[]) => boolean;
  /** Optional custom valid targets list */
  validTargetIds?: string[];
  /** Whether player can be targeted */
  canTargetPlayer?: boolean;
  /** Player names for display */
  playerNames?: { [playerId: string]: string };
  /** Player IDs that can be targeted */
  targetablePlayerIds?: string[];
}

/**
 * Targeting Overlay Component
 * Displays targeting UI and handles target selection
 * Implements issue #27 - Targeting system
 */
export function TargetingOverlay({
  targetingState,
  sourceCardName = "this card",
  sourceAbilityName,
  onTargetSelect,
  onConfirm,
  onCancel,
  canTargetPlayer = false,
  playerNames = {},
  targetablePlayerIds = [],
}: TargetingOverlayProps) {
  const [showConfirmDialog, setShowConfirmDialog] = React.useState(false);

  if (!targetingState.isActive) {
    return null;
  }

  const { selectedTargets, minTargets, maxTargets } = targetingState;
  const canConfirm = selectedTargets.length >= minTargets;

  // Get display name for a target
  const getTargetDisplayName = (target: SelectedTarget): string => {
    if (target.targetType === "player") {
      return playerNames[target.targetId] || "Player";
    }
    return "Card"; // Card names would need to be passed in
  };

  // Handle confirm button click
  const handleConfirmClick = () => {
    if (selectedTargets.length === 1 && minTargets === 1) {
      // Auto-confirm for single target
      onConfirm();
    } else {
      setShowConfirmDialog(true);
    }
  };

  // Handle final confirmation
  const handleConfirm = () => {
    setShowConfirmDialog(false);
    onConfirm();
  };

  return (
    <>
      {/* Targeting indicator overlay */}
      <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-in fade-in slide-in-from-top-4">
        <Card className="border-2 border-primary bg-primary/10 shadow-lg">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-2">
                <Crosshair className="h-5 w-5 text-primary animate-pulse" />
                <span className="font-medium">Select Target</span>
              </div>
              
              <div className="text-sm text-muted-foreground">
                {sourceAbilityName ? (
                  <span>
                    for <span className="text-primary font-medium">{sourceAbilityName}</span>
                  </span>
                ) : (
                  <span>
                    targeting with <span className="text-primary font-medium">{sourceCardName}</span>
                  </span>
                )}
              </div>

              <Badge variant="outline" className="ml-2">
                {selectedTargets.length} / {maxTargets}
              </Badge>
            </div>

            {/* Selected targets display */}
            {selectedTargets.length > 0 && (
              <div className="mt-3 pt-3 border-t border-primary/20">
                <div className="text-xs text-muted-foreground mb-1">Selected:</div>
                <div className="flex flex-wrap gap-1">
                  {selectedTargets.map((target, index) => (
                    <Badge
                      key={`${target.targetType}-${target.targetId}-${index}`}
                      variant="secondary"
                      className="cursor-pointer hover:bg-destructive/20"
                      onClick={() => {
                        if (target.targetType === "card" || target.targetType === "player") {
                          onTargetSelect(target.targetId, target.targetType);
                        }
                      }}
                    >
                      {target.targetType === "player" ? (
                        <User className="h-3 w-3 mr-1" />
                      ) : (
                        <Target className="h-3 w-3 mr-1" />
                      )}
                      {getTargetDisplayName(target)}
                      <X className="h-3 w-3 ml-1" />
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Instructions */}
            <div className="mt-3 text-xs text-muted-foreground">
              {minTargets === maxTargets ? (
                <span>Select {minTargets} target{minTargets > 1 ? "s" : ""}</span>
              ) : (
                <span>Select {minTargets}-{maxTargets} targets</span>
              )}
              {canTargetPlayer && (
                <span> (you can also target a player)</span>
              )}
            </div>

            {/* Action buttons */}
            <div className="mt-3 flex gap-2">
              <Button
                size="sm"
                onClick={handleConfirmClick}
                disabled={!canConfirm}
                className="flex-1"
              >
                <Check className="h-4 w-4 mr-1" />
                Confirm
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={onCancel}
              >
                <X className="h-4 w-4 mr-1" />
                Cancel
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Valid target highlight message */}
      {targetingState.validTargetTypes.length > 0 && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-40">
          <Card className="border border-amber-500/30 bg-amber-500/10">
            <CardContent className="p-2 px-3">
              <div className="flex items-center gap-2 text-sm">
                <AlertCircle className="h-4 w-4 text-amber-500" />
                <span className="text-amber-700 dark:text-amber-300">
                  Valid targets: {targetingState.validTargetTypes.join(", ")}
                </span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Player targeting options */}
      {canTargetPlayer && targetablePlayerIds.length > 0 && (
        <div className="fixed bottom-20 left-1/2 -translate-x-1/2 z-40">
          <Card className="border border-primary/30 bg-background/95">
            <CardContent className="p-3">
              <div className="flex items-center gap-2 mb-2">
                <Users className="h-4 w-4" />
                <span className="text-sm font-medium">Target Player</span>
              </div>
              <div className="flex gap-2">
                {targetablePlayerIds.map((playerId) => (
                  <Button
                    key={playerId}
                    size="sm"
                    variant={
                      selectedTargets.some((t) => t.targetId === playerId)
                        ? "default"
                        : "outline"
                    }
                    onClick={() => onTargetSelect(playerId, "player")}
                    className="gap-1"
                  >
                    <User className="h-3 w-3" />
                    {playerNames[playerId] || "Player"}
                  </Button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Confirm Targets</DialogTitle>
            <DialogDescription>
              You have selected {selectedTargets.length} target{selectedTargets.length > 1 ? "s" : ""}. 
              {minTargets > 1 && selectedTargets.length < minTargets && (
                <span className="text-destructive">
                  {" "}You must select at least {minTargets} targets.
                </span>
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* Source info */}
            <div className="bg-muted p-3 rounded-md">
              <div className="text-sm text-muted-foreground">
                {sourceAbilityName ? (
                  <span>
                    Activating <span className="font-medium">{sourceAbilityName}</span> on{" "}
                    <span className="font-medium">{sourceCardName}</span>
                  </span>
                ) : (
                  <span>
                    Targeting with <span className="font-medium">{sourceCardName}</span>
                  </span>
                )}
              </div>
            </div>

            {/* Selected targets */}
            {selectedTargets.length > 0 && (
              <div>
                <div className="text-sm font-medium mb-2">Selected Targets:</div>
                <ScrollArea className="h-[150px]">
                  <div className="space-y-2">
                    {selectedTargets.map((target, index) => (
                      <div
                        key={`${target.targetType}-${target.targetId}-${index}`}
                        className="flex items-center gap-2 p-2 bg-muted rounded-md"
                      >
                        {target.targetType === "player" ? (
                          <User className="h-4 w-4" />
                        ) : (
                          <Target className="h-4 w-4" />
                        )}
                        <span>{getTargetDisplayName(target)}</span>
                        <Badge variant="outline" className="ml-auto">
                          {target.targetType}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmDialog(false)}>
              <X className="h-4 w-4 mr-1" />
              Go Back
            </Button>
            <Button onClick={handleConfirm} disabled={!canConfirm}>
              <Check className="h-4 w-4 mr-1" />
              Confirm Targets
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Hook to create targeting state helpers
 */
export function useTargetingHelpers() {
  /**
   * Check if a card matches target requirements
   */
  const validateCardTarget = React.useCallback(
    (
      cardTypes: string[],
      validTypes: string[],
      canTargetSelf: boolean = false
    ): { isValid: boolean; reason?: string } => {
      if (validTypes.length === 0) {
        return { isValid: true };
      }

      // Check if card has any of the valid types
      const hasValidType = cardTypes.some((type) =>
        validTypes.includes(type.toLowerCase())
      );

      if (!hasValidType) {
        return {
          isValid: false,
          reason: `Card must be one of: ${validTypes.join(", ")}`,
        };
      }

      return { isValid: true };
    },
    []
  );

  /**
   * Check if a player can be targeted
   */
  const validatePlayerTarget = React.useCallback(
    (canTargetPlayer: boolean): { isValid: boolean; reason?: string } => {
      if (!canTargetPlayer) {
        return {
          isValid: false,
          reason: "Cannot target players with this ability",
        };
      }
      return { isValid: true };
    },
    []
  );

  return {
    validateCardTarget,
    validatePlayerTarget,
  };
}

export default TargetingOverlay;
