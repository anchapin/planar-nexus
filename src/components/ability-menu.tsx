"use client";

import * as React from "react";
import { CardAbility, TargetRequirement } from "@/types/card-interactions";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  AlertCircle,
  Check,
  X,
  Zap,
  Shield,
  Crosshair,
  Info,
  ArrowRight,
} from "lucide-react";

interface AbilityMenuProps {
  /** Whether the menu is open */
  open: boolean;
  /** Callback when menu is closed */
  onOpenChange: (open: boolean) => void;
  /** The card's abilities */
  abilities: CardAbility[];
  /** The card's name for display */
  cardName: string;
  /** Card types for display */
  cardTypes: string[];
  /** Callback when an ability is activated */
  onAbilityActivate: (abilityIndex: number) => void;
  /** Callback to start targeting mode */
  onStartTargeting: (abilityIndex: number, requirements?: TargetRequirement) => void;
  /** Current mana available */
  availableMana?: {
    colorless?: number;
    white?: number;
    blue?: number;
    black?: number;
    red?: number;
    green?: number;
    generic?: number;
  };
  /** Whether the card is tapped (can't activate abilities if tapped) */
  isTapped?: boolean;
}

/**
 * Ability Menu Component
 * Displays activated abilities on a card and handles activation
 * Implements issue #26 - Activated ability menu system
 */
export function AbilityMenu({
  open,
  onOpenChange,
  abilities,
  cardName,
  cardTypes,
  onAbilityActivate,
  onStartTargeting,
  availableMana = {},
  isTapped = false,
}: AbilityMenuProps) {
  const [selectedAbilityIndex, setSelectedAbilityIndex] = React.useState<number | null>(null);
  const [showConfirmation, setShowConfirmation] = React.useState(false);

  // Reset state when menu closes
  React.useEffect(() => {
    if (!open) {
      setSelectedAbilityIndex(null);
      setShowConfirmation(false);
    }
  }, [open]);

  // Parse mana cost and check if affordable
  const canAffordAbility = (ability: CardAbility): boolean => {
    if (!ability.manaCost) return true;
    if (isTapped) return false;

    // Simple mana cost parsing - in real implementation, this would be more sophisticated
    // Check for {W}, {U}, {B}, {R}, {G}, {C}, {X}
    const cost = ability.manaCost;
    
    // Count colored mana costs
    const whiteMatch = (cost.match(/\{W\}/g) || []).length;
    const blueMatch = (cost.match(/\{U\}/g) || []).length;
    const blackMatch = (cost.match(/\{B\}/g) || []).length;
    const redMatch = (cost.match(/\{R\}/g) || []).length;
    const greenMatch = (cost.match(/\{G\}/g) || []).length;
    const colorlessMatch = (cost.match(/\{[0-9]+\}/g) || []).length;

    // Check against available mana
    if (
      (availableMana.white || 0) < whiteMatch ||
      (availableMana.blue || 0) < blueMatch ||
      (availableMana.black || 0) < blackMatch ||
      (availableMana.red || 0) < redMatch ||
      (availableMana.green || 0) < greenMatch ||
      (availableMana.colorless || 0) + (availableMana.generic || 0) < colorlessMatch
    ) {
      return false;
    }

    return true;
  };

  // Get display info for an ability
  const getAbilityDisplayInfo = (ability: CardAbility) => {
    const canActivate = ability.isActivatable && canAffordAbility(ability);
    let reason = ability.activatableReason;

    if (isTapped && !reason) {
      reason = "Card is tapped";
    } else if (!canAffordAbility(ability) && !reason) {
      reason = "Not enough mana";
    }

    return { canActivate, reason };
  };

  // Handle ability selection
  const handleAbilitySelect = (index: number) => {
    const ability = abilities[index];
    const { canActivate, reason } = getAbilityDisplayInfo(ability);

    if (!canActivate) {
      // Can't activate - show why
      return;
    }

    setSelectedAbilityIndex(index);

    // If it has targets, start targeting
    if (ability.hasTargets && ability.targetRequirements) {
      onStartTargeting(index, ability.targetRequirements);
      onOpenChange(false);
      return;
    }

    // Otherwise, show confirmation
    setShowConfirmation(true);
  };

  // Handle ability activation confirmation
  const handleConfirmActivation = () => {
    if (selectedAbilityIndex !== null) {
      onAbilityActivate(selectedAbilityIndex);
      onOpenChange(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Zap className="h-5 w-5" />
            {cardName} - Abilities
          </DialogTitle>
          <DialogDescription>
            Select an ability to activate
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Card type display */}
          <div className="flex flex-wrap gap-1">
            {cardTypes.map((type) => (
              <Badge key={type} variant="secondary" className="text-xs">
                {type}
              </Badge>
            ))}
          </div>

          <Separator />

          {/* Tapped warning */}
          {isTapped && (
            <div className="bg-amber-500/10 border border-amber-500/30 rounded-md p-3 flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-amber-500" />
              <span className="text-sm text-amber-700 dark:text-amber-300">
                This card is tapped and cannot activate abilities
              </span>
            </div>
          )}

          {/* Mana display */}
          <div className="flex gap-2 text-sm">
            <span className="text-muted-foreground">Available:</span>
            <div className="flex gap-1">
              {(availableMana.white || 0) > 0 && (
                <Badge variant="outline" className="bg-white/10">{availableMana.white}W</Badge>
              )}
              {(availableMana.blue || 0) > 0 && (
                <Badge variant="outline" className="bg-blue-500/10 text-blue-500">{availableMana.blue}U</Badge>
              )}
              {(availableMana.black || 0) > 0 && (
                <Badge variant="outline" className="bg-black/30">{availableMana.black}B</Badge>
              )}
              {(availableMana.red || 0) > 0 && (
                <Badge variant="outline" className="bg-red-500/10 text-red-500">{availableMana.red}R</Badge>
              )}
              {(availableMana.green || 0) > 0 && (
                <Badge variant="outline" className="bg-green-500/10 text-green-500">{availableMana.green}G</Badge>
              )}
              {((availableMana.colorless || 0) + (availableMana.generic || 0)) > 0 && (
                <Badge variant="outline">{(availableMana.colorless || 0) + (availableMana.generic || 0)}C</Badge>
              )}
            </div>
          </div>

          <Separator />

          {/* Abilities list */}
          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-2">
              {abilities.map((ability, index) => {
                const { canActivate, reason } = getAbilityDisplayInfo(ability);

                return (
                  <button
                    key={ability.id || index}
                    onClick={() => handleAbilitySelect(index)}
                    disabled={!canActivate}
                    className={`w-full text-left p-3 rounded-md border transition-colors ${
                      canActivate
                        ? "border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                        : "border-border/50 bg-muted/30 cursor-not-allowed opacity-60"
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{ability.name}</span>
                          {ability.manaCost && (
                            <Badge variant="outline" className="text-xs font-mono">
                              {ability.manaCost}
                            </Badge>
                          )}
                          {ability.loyaltyCost && (
                            <Badge variant="outline" className="text-xs">
                              {ability.loyaltyCost > 0 ? `+${ability.loyaltyCost}` : ability.loyaltyCost}
                            </Badge>
                          )}
                          {ability.hasTargets && (
                            <Crosshair className="h-3 w-3 text-muted-foreground" />
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground mt-1">{ability.text}</p>
                      </div>

                      {!canActivate && reason && (
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <Info className="h-4 w-4 text-amber-500 shrink-0" />
                            </TooltipTrigger>
                            <TooltipContent>
                              <p>{reason}</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Activate Ability</DialogTitle>
            <DialogDescription>
              Confirm activation of {abilities[selectedAbilityIndex || 0]?.name}
            </DialogDescription>
          </DialogHeader>

          {selectedAbilityIndex !== null && (
            <div className="space-y-4">
              <div className="bg-muted p-3 rounded-md">
                <div className="font-medium">{abilities[selectedAbilityIndex].name}</div>
                <div className="text-sm text-muted-foreground">
                  {abilities[selectedAbilityIndex].text}
                </div>
                {abilities[selectedAbilityIndex].manaCost && (
                  <div className="mt-2">
                    <Badge variant="outline">
                      Cost: {abilities[selectedAbilityIndex].manaCost}
                    </Badge>
                  </div>
                )}
              </div>

              {abilities[selectedAbilityIndex].additionalCosts && 
               abilities[selectedAbilityIndex].additionalCosts!.length > 0 && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Additional costs: </span>
                  {abilities[selectedAbilityIndex].additionalCosts?.join(", ")}
                </div>
              )}
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowConfirmation(false)}>
              <X className="h-4 w-4 mr-1" />
              Cancel
            </Button>
            <Button onClick={handleConfirmActivation}>
              <Check className="h-4 w-4 mr-1" />
              Activate
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
}

export default AbilityMenu;
