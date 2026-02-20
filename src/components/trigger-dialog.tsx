"use client";

import * as React from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  AlertCircle,
  Check,
  X,
  Info,
  Zap,
  Clock,
  ArrowUpDown,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Types for optional trigger dialogs
 */

export interface OptionalTrigger {
  /** Unique identifier */
  id: string;
  /** Name of the trigger (e.g., "Chromatic Star - ETB") */
  name: string;
  /** Description of what the trigger does */
  description: string;
  /** Whether this is optional (may effect) */
  isOptional: boolean;
  /** Source card name */
  sourceCardName: string;
  /** Source card ID */
  sourceCardId: string;
  /** Timing (immediate, end of turn, etc.) */
  timing: "immediate" | "end_of_turn" | "upkeep" | "draw" | "combat";
  /** Whether there are multiple triggers to order */
  hasMultipleTriggers?: boolean;
  /** Order index if multiple triggers */
  orderIndex?: number;
}

export interface TriggerChoice {
  triggerId: string;
  choice: "yes" | "no";
  timestamp: number;
}

export interface SavedTriggerPreference {
  triggerPattern: string; // Pattern to match (e.g., "Chromatic Star")
  choice: "yes" | "no" | "ask";
  applyToAllSimilar?: boolean;
}

interface TriggerDialogProps {
  /** Whether the dialog is open */
  open: boolean;
  /** Callback when dialog is closed */
  onOpenChange: (open: boolean) => void;
  /** List of optional triggers waiting for decision */
  triggers: OptionalTrigger[];
  /** Callback when a trigger choice is made */
  onTriggerChoice: (choices: TriggerChoice[]) => void;
  /** Callback when trigger order is set */
  onTriggerOrder?: (orderedTriggerIds: string[]) => void;
  /** Callback to save preference for similar triggers */
  onSavePreference?: (preference: SavedTriggerPreference) => void;
  /** Saved preferences */
  savedPreferences?: SavedTriggerPreference[];
  /** Current player mana (for decision context) */
  availableMana?: {
    white?: number;
    blue?: number;
    black?: number;
    red?: number;
    green?: number;
    colorless?: number;
  };
}

/**
 * Optional Trigger Dialog Component
 * Implements issue #30 - Optional trigger dialogs
 */
export function TriggerDialog({
  open,
  onOpenChange,
  triggers,
  onTriggerChoice,
  onTriggerOrder,
  onSavePreference,
  savedPreferences = [],
}: TriggerDialogProps) {
  // State for trigger choices
  const [triggerChoices, setTriggerChoices] = React.useState<Map<string, "yes" | "no">>(new Map());
  // State for trigger ordering
  const [triggerOrder, setTriggerOrder] = React.useState<string[]>([]);
  // State for "remember my choice" checkbox
  const [rememberChoice, setRememberChoice] = React.useState(false);
  // State for "apply to all similar" checkbox
  const [applyToSimilar, setApplyToSimilar] = React.useState(false);
  // Track if we've checked saved preferences
  const [checkedPreferences, setCheckedPreferences] = React.useState(false);

  // Reset state when dialog opens
  React.useEffect(() => {
    if (open) {
      // Initialize choices
      const initialChoices = new Map<string, "yes" | "no">();
      triggers.forEach((trigger) => {
        initialChoices.set(trigger.id, "no"); // Default to "no"
      });
      setTriggerChoices(initialChoices);

      // Initialize order
      setTriggerOrder(triggers.map((t) => t.id));

      // Check saved preferences and auto-select
      if (!checkedPreferences) {
        const newChoices = new Map(initialChoices);
        let hasAutoSelected = false;

        triggers.forEach((trigger) => {
          const preference = savedPreferences.find(
            (p) => trigger.sourceCardName.toLowerCase().includes(p.triggerPattern.toLowerCase())
          );
          if (preference && preference.choice !== "ask") {
            newChoices.set(trigger.id, preference.choice);
            hasAutoSelected = true;
          }
        });

        if (hasAutoSelected) {
          setTriggerChoices(newChoices);
        }
        setCheckedPreferences(true);
      }

      setRememberChoice(false);
      setApplyToSimilar(false);
    }
  }, [open, triggers, savedPreferences, checkedPreferences]);

  // Handle choice change
  const handleChoiceChange = (triggerId: string, choice: "yes" | "no") => {
    const newChoices = new Map(triggerChoices);
    newChoices.set(triggerId, choice);
    setTriggerChoices(newChoices);
  };

  // Handle "yes to all"
  const handleYesToAll = () => {
    const newChoices = new Map<string, "yes" | "no">();
    triggers.forEach((trigger) => {
      newChoices.set(trigger.id, "yes");
    });
    setTriggerChoices(newChoices);
  };

  // Handle "no to all"
  const handleNoToAll = () => {
    const newChoices = new Map<string, "yes" | "no">();
    triggers.forEach((trigger) => {
      newChoices.set(trigger.id, "no");
    });
    setTriggerChoices(newChoices);
  };

  // Handle trigger order change (move up)
  const moveTriggerUp = (index: number) => {
    if (index <= 0) return;
    const newOrder = [...triggerOrder];
    [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
    setTriggerOrder(newOrder);
  };

  // Handle trigger order change (move down)
  const moveTriggerDown = (index: number) => {
    if (index >= triggerOrder.length - 1) return;
    const newOrder = [...triggerOrder];
    [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
    setTriggerOrder(newOrder);
  };

  // Handle confirm
  const handleConfirm = () => {
    // Build choices array
    const choices: TriggerChoice[] = Array.from(triggerChoices.entries()).map(([triggerId, choice]) => ({
      triggerId,
      choice,
      timestamp: Date.now(),
    }));

    // Apply order
    if (onTriggerOrder && triggerOrder.length > 0) {
      onTriggerOrder(triggerOrder);
    }

    // Save preference if requested
    if (rememberChoice && onSavePreference) {
      triggers.forEach((trigger) => {
        const choice = triggerChoices.get(trigger.id);
        if (choice) {
          onSavePreference({
            triggerPattern: trigger.sourceCardName,
            choice,
            applyToAllSimilar: applyToSimilar,
          });
        }
      });
    }

    onTriggerChoice(choices);
    onOpenChange(false);
  };

  // Get trigger by ID
  const getTrigger = (id: string) => triggers.find((t) => t.id === id);

  // Check if we have multiple triggers that need ordering
  const hasMultipleTriggers = triggers.length > 1;
  const needsOrdering = hasMultipleTriggers;

  // Get timing icon
  const getTimingIcon = (timing: OptionalTrigger["timing"]) => {
    switch (timing) {
      case "immediate":
        return <Zap className="h-4 w-4" />;
      case "end_of_turn":
        return <Clock className="h-4 w-4" />;
      case "upkeep":
        return <AlertCircle className="h-4 w-4" />;
      case "draw":
        return <Info className="h-4 w-4" />;
      case "combat":
        return <Zap className="h-4 w-4" />;
      default:
        return <Info className="h-4 w-4" />;
    }
  };

  // Get timing label
  const getTimingLabel = (timing: OptionalTrigger["timing"]) => {
    switch (timing) {
      case "immediate":
        return "Immediate";
      case "end_of_turn":
        return "End of Turn";
      case "upkeep":
        return "Upkeep";
      case "draw":
        return "Draw Step";
      case "combat":
        return "Combat";
      default:
        return timing;
    }
  };

  // Can we confirm?
  const canConfirm = () => {
    return triggers.every((trigger) => triggerChoices.has(trigger.id));
  };

  // Render trigger card
  const renderTriggerCard = (trigger: OptionalTrigger, index: number) => {
    const choice = triggerChoices.get(trigger.id) || "no";
    const isYes = choice === "yes";

    return (
      <Card key={trigger.id} className={cn("mb-2", isYes && "border-green-500 bg-green-500/5")}>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span>{trigger.name}</span>
              {trigger.isOptional && (
                <Badge variant="outline" className="text-xs">
                  Optional
                </Badge>
              )}
            </div>
            {needsOrdering && (
              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => moveTriggerUp(index)}
                  disabled={index === 0}
                >
                  <ArrowUpDown className="h-3 w-3 rotate-[-90deg]" />
                </Button>
                <span className="text-xs text-muted-foreground">{index + 1}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 p-0"
                  onClick={() => moveTriggerDown(index)}
                  disabled={index === triggerOrder.length - 1}
                >
                  <ArrowUpDown className="h-3 w-3 rotate-90" />
                </Button>
              </div>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-0">
          <p className="text-sm text-muted-foreground mb-3">{trigger.description}</p>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Badge variant="secondary" className="text-xs">
                {trigger.sourceCardName}
              </Badge>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Badge variant="outline" className="text-xs flex items-center gap-1">
                      {getTimingIcon(trigger.timing)}
                      {getTimingLabel(trigger.timing)}
                    </Badge>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p>Trigger timing: {getTimingLabel(trigger.timing)}</p>
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>

            <div className="flex gap-2">
              <Button
                variant={isYes ? "default" : "outline"}
                size="sm"
                onClick={() => handleChoiceChange(trigger.id, "yes")}
                className={cn(isYes && "bg-green-500 hover:bg-green-600")}
              >
                <Check className="h-4 w-4 mr-1" />
                Yes
              </Button>
              <Button
                variant={!isYes ? "default" : "outline"}
                size="sm"
                onClick={() => handleChoiceChange(trigger.id, "no")}
                className={cn(!isYes && "bg-red-500 hover:bg-red-600")}
              >
                <X className="h-4 w-4 mr-1" />
                No
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  };

  // Render the dialog content
  const renderContent = () => (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold flex items-center justify-center gap-2">
          <AlertCircle className="h-5 w-5" />
          Optional Triggers
        </h3>
        <p className="text-sm text-muted-foreground">
          Choose whether to trigger each ability. You can save your preference for future triggers.
        </p>
      </div>

      <Separator />

      {/* Quick actions */}
      <div className="flex justify-center gap-2">
        <Button variant="outline" size="sm" onClick={handleYesToAll}>
          <Check className="h-4 w-4 mr-1" />
          Yes to All
        </Button>
        <Button variant="outline" size="sm" onClick={handleNoToAll}>
          <X className="h-4 w-4 mr-1" />
          No to All
        </Button>
      </div>

      <Separator />

      {/* Trigger list */}
      <ScrollArea className="h-[300px] pr-4">
        <div className="space-y-2">
          {triggerOrder.map((triggerId, index) => {
            const trigger = getTrigger(triggerId);
            return trigger ? renderTriggerCard(trigger, index) : null;
          })}
        </div>
      </ScrollArea>

      <Separator />

      {/* Save preference option */}
      <div className="space-y-2">
        <div className="flex items-center space-x-2">
          <Checkbox
            id="remember-choice"
            checked={rememberChoice}
            onCheckedChange={(checked) => setRememberChoice(checked as boolean)}
          />
          <Label htmlFor="remember-choice" className="text-sm cursor-pointer">
            Remember my choice for this card
          </Label>
        </div>

        {rememberChoice && (
          <div className="flex items-center space-x-2 ml-6">
            <Checkbox
              id="apply-similar"
              checked={applyToSimilar}
              onCheckedChange={(checked) => setApplyToSimilar(checked as boolean)}
            />
            <Label htmlFor="apply-similar" className="text-sm cursor-pointer">
              Apply to all similar triggers
            </Label>
          </div>
        )}

        {savedPreferences.length > 0 && (
          <div className="text-xs text-muted-foreground ml-6">
            <span className="font-medium">Saved preferences:</span>{" "}
            {savedPreferences.map((p) => p.triggerPattern).join(", ")}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertCircle className="h-5 w-5" />
            Optional Triggers
          </DialogTitle>
          <DialogDescription>
            {triggers.length === 1
              ? "An optional triggered ability is waiting for your decision."
              : `${triggers.length} optional triggered abilities are waiting for your decision.`}
          </DialogDescription>
        </DialogHeader>

        {triggers.length > 0 ? (
          renderContent()
        ) : (
          <div className="text-center py-8 text-muted-foreground">
            No triggers to resolve
          </div>
        )}

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            <X className="h-4 w-4 mr-1" />
            Cancel
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm()}>
            <Check className="h-4 w-4 mr-1" />
            Confirm Choices
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Hook for managing optional triggers
 */
export function useOptionalTriggers() {
  const [pendingTriggers, setPendingTriggers] = React.useState<OptionalTrigger[]>([]);
  const [showTriggerDialog, setShowTriggerDialog] = React.useState(false);
  const [savedPreferences, setSavedPreferences] = React.useState<SavedTriggerPreference[]>([]);

  // Add a trigger to the queue
  const addTrigger = React.useCallback((trigger: OptionalTrigger) => {
    setPendingTriggers((prev) => [...prev, trigger]);
    setShowTriggerDialog(true);
  }, []);

  // Add multiple triggers
  const addTriggers = React.useCallback((newTriggers: OptionalTrigger[]) => {
    setPendingTriggers((prev) => [...prev, ...newTriggers]);
    setShowTriggerDialog(true);
  }, []);

  // Handle trigger choices
  const handleTriggerChoices = React.useCallback((choices: TriggerChoice[]) => {
    // Process each choice
    choices.forEach((choice) => {
      console.log(`Trigger ${choice.triggerId}: ${choice.choice}`);
      // Here you would actually execute the trigger or skip it
    });

    // Clear resolved triggers
    setPendingTriggers((prev) =>
      prev.filter((t) => !choices.some((c) => c.triggerId === t.id))
    );

    // Close dialog if no more triggers
    if (pendingTriggers.length === choices.length) {
      setShowTriggerDialog(false);
    }
  }, [pendingTriggers]);

  // Handle trigger order
  const handleTriggerOrder = React.useCallback((orderedIds: string[]) => {
    console.log("Trigger order:", orderedIds);
    // Reorder triggers based on user preference
    setPendingTriggers((prev) => {
      const reordered = orderedIds.map((id) => prev.find((t) => t.id === id)).filter(Boolean) as OptionalTrigger[];
      return reordered;
    });
  }, []);

  // Save preference
  const handleSavePreference = React.useCallback((preference: SavedTriggerPreference) => {
    setSavedPreferences((prev) => {
      // Remove existing preference for same pattern
      const filtered = prev.filter((p) => p.triggerPattern !== preference.triggerPattern);
      return [...filtered, preference];
    });
  }, []);

  // Clear all pending triggers
  const clearTriggers = React.useCallback(() => {
    setPendingTriggers([]);
    setShowTriggerDialog(false);
  }, []);

  return {
    pendingTriggers,
    showTriggerDialog,
    setShowTriggerDialog,
    savedPreferences,
    addTrigger,
    addTriggers,
    handleTriggerChoices,
    handleTriggerOrder,
    handleSavePreference,
    clearTriggers,
  };
}

export default TriggerDialog;
