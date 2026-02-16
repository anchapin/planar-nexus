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
import {
  Swords,
  Shield,
  AlertTriangle,
  Check,
  X,
  Info,
  ArrowRight,
  GripVertical,
  RotateCcw,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Types for combat declaration
 */

export interface CombatCard {
  id: string;
  name: string;
  power: number;
  toughness: number;
  isTapped: boolean;
  canAttack: boolean;
  canBlock: boolean;
  hasSummoningSickness: boolean;
  isAttacking: boolean;
  isBlocking: boolean;
  blockerAssignments: string[];
}

export interface CombatDeclarationState {
  phase: "declare-attackers" | "declare-blockers" | "damage-order" | "confirm";
  availableAttackers: CombatCard[];
  availableBlockers: CombatCard[];
  attackers: CombatCard[];
  blockerAssignments: Map<string, string[]>;
  damageOrder: Map<string, string[]>;
}

interface CombatDeclarationProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  combatPhase: "declare-attackers" | "declare-blockers" | "damage-order" | "confirm";
  onPhaseChange?: (phase: "declare-attackers" | "declare-blockers" | "damage-order" | "confirm") => void;
  attackers: CombatCard[];
  blockers: CombatCard[];
  onDeclareAttackers: (attackerIds: string[]) => void;
  onAssignBlockers: (assignments: Map<string, string[]>) => void;
  onSetDamageOrder: (damageOrder: Map<string, string[]>) => void;
  onConfirmCombat: () => void;
  onGoBack?: () => void;
  declaredAttackers: string[];
  currentBlockerAssignments: Map<string, string[]>;
  currentDamageOrder: Map<string, string[]>;
}

/**
 * Combat Declaration Component
 * Implements issue #28 - Attack/block declaration UI
 */
export function CombatDeclaration({
  open,
  onOpenChange,
  combatPhase,
  onPhaseChange,
  attackers,
  blockers,
  onDeclareAttackers,
  onAssignBlockers,
  onSetDamageOrder,
  onConfirmCombat,
  onGoBack,
  declaredAttackers = [],
  currentBlockerAssignments = new Map(),
  currentDamageOrder = new Map(),
}: CombatDeclarationProps) {
  const [selectedAttackers, setSelectedAttackers] = React.useState<Set<string>>(
    new Set(declaredAttackers)
  );
  const [blockerAssignments, setBlockerAssignments] = React.useState<Map<string, string[]>>(
    new Map(currentBlockerAssignments)
  );
  const [damageOrder, setDamageOrder] = React.useState<Map<string, string[]>>(
    new Map(currentDamageOrder)
  );
  const [selectedAttackerForBlocking, setSelectedAttackerForBlocking] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setSelectedAttackers(new Set(declaredAttackers));
      setBlockerAssignments(new Map(currentBlockerAssignments));
      setDamageOrder(new Map(currentDamageOrder));
      setSelectedAttackerForBlocking(null);
    }
  }, [open, declaredAttackers, currentBlockerAssignments, currentDamageOrder]);

  const availableAttackers = attackers.filter((card) => card.canAttack && !card.isTapped);
  const availableBlockers = blockers.filter((card) => card.canBlock && !card.isTapped);

  const toggleAttacker = (cardId: string) => {
    const newSelection = new Set(selectedAttackers);
    if (newSelection.has(cardId)) {
      newSelection.delete(cardId);
      const newAssignments = new Map(blockerAssignments);
      newAssignments.delete(cardId);
      setBlockerAssignments(newAssignments);
    } else {
      newSelection.add(cardId);
    }
    setSelectedAttackers(newSelection);
  };

  const toggleBlocker = (attackerId: string, blockerId: string) => {
    const currentBlockers = blockerAssignments.get(attackerId) || [];
    const newBlockers = currentBlockers.includes(blockerId)
      ? currentBlockers.filter((id) => id !== blockerId)
      : [...currentBlockers, blockerId];

    const newAssignments = new Map(blockerAssignments);
    if (newBlockers.length > 0) {
      newAssignments.set(attackerId, newBlockers);
    } else {
      newAssignments.delete(attackerId);
    }
    setBlockerAssignments(newAssignments);
  };

  const moveBlockerUp = (attackerId: string, blockerIndex: number) => {
    if (blockerIndex <= 0) return;
    const currentOrder = damageOrder.get(attackerId) || blockerAssignments.get(attackerId) || [];
    const newOrder = [...currentOrder];
    [newOrder[blockerIndex - 1], newOrder[blockerIndex]] = [newOrder[blockerIndex], newOrder[blockerIndex - 1]];
    const newDamageOrder = new Map(damageOrder);
    newDamageOrder.set(attackerId, newOrder);
    setDamageOrder(newDamageOrder);
  };

  const moveBlockerDown = (attackerId: string, blockerIndex: number) => {
    const currentOrder = damageOrder.get(attackerId) || blockerAssignments.get(attackerId) || [];
    if (blockerIndex >= currentOrder.length - 1) return;
    const newOrder = [...currentOrder];
    [newOrder[blockerIndex], newOrder[blockerIndex + 1]] = [newOrder[blockerIndex + 1], newOrder[blockerIndex]];
    const newDamageOrder = new Map(damageOrder);
    newDamageOrder.set(attackerId, newOrder);
    setDamageOrder(newDamageOrder);
  };

  const handleProceedToBlockers = () => {
    onDeclareAttackers(Array.from(selectedAttackers));
    onPhaseChange?.("declare-blockers");
  };

  const handleProceedToDamageOrder = () => {
    onAssignBlockers(blockerAssignments);
    const initialDamageOrder = new Map(blockerAssignments);
    setDamageOrder(new Map(initialDamageOrder));
    onPhaseChange?.("damage-order");
  };

  const handleConfirm = () => {
    onAssignBlockers(blockerAssignments);
    onSetDamageOrder(damageOrder);
    onConfirmCombat();
    onOpenChange(false);
  };

  const getAttackerCard = (id: string) => attackers.find((a) => a.id === id);
  const getBlockerCard = (id: string) => blockers.find((b) => b.id === id);

  const renderAttackerCard = (card: CombatCard, isSelected: boolean, onClick?: () => void) => (
    <button
      key={card.id}
      onClick={onClick}
      className={cn(
        "relative w-20 h-28 bg-gradient-to-br from-primary/20 to-primary/5 border-2 rounded-lg",
        "flex flex-col items-center justify-between p-2 cursor-pointer transition-all",
        "hover:scale-105 hover:shadow-lg",
        card.isTapped && "rotate-90 opacity-60",
        isSelected && !card.isAttacking && "border-red-500 shadow-lg shadow-red-500/30 ring-2 ring-red-500",
        card.isAttacking && "border-red-500 bg-red-500/10",
        !card.canAttack && "opacity-40 cursor-not-allowed"
      )}
      disabled={!card.canAttack}
    >
      <span className="text-xs font-medium truncate w-full text-center">{card.name}</span>
      <div className="flex items-center justify-center gap-1">
        <span className="text-sm font-bold">{card.power}</span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-sm font-bold">{card.toughness}</span>
      </div>
      {isSelected && (
        <div className="absolute top-1 right-1 w-5 h-5 bg-red-500 rounded-full flex items-center justify-center">
          <Check className="h-3 w-3 text-white" />
        </div>
      )}
      {card.hasSummoningSickness && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <div className="absolute bottom-1 left-1">
                <AlertTriangle className="h-3 w-3 text-amber-500" />
              </div>
            </TooltipTrigger>
            <TooltipContent>
              <p>Summoning sickness - cannot attack</p>
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </button>
  );

  const renderBlockerCard = (card: CombatCard, isBlocking: boolean, onClick?: () => void) => (
    <button
      key={card.id}
      onClick={onClick}
      className={cn(
        "relative w-20 h-28 bg-gradient-to-br from-blue-500/20 to-blue-500/5 border-2 rounded-lg",
        "flex flex-col items-center justify-between p-2 cursor-pointer transition-all",
        "hover:scale-105 hover:shadow-lg",
        card.isTapped && "rotate-90 opacity-60",
        isBlocking && "border-blue-500 shadow-lg shadow-blue-500/30 ring-2 ring-blue-500",
        !card.canBlock && "opacity-40 cursor-not-allowed"
      )}
      disabled={!card.canBlock}
    >
      <span className="text-xs font-medium truncate w-full text-center">{card.name}</span>
      <div className="flex items-center justify-center gap-1">
        <span className="text-sm font-bold">{card.power}</span>
        <span className="text-xs text-muted-foreground">/</span>
        <span className="text-sm font-bold">{card.toughness}</span>
      </div>
      {isBlocking && (
        <div className="absolute top-1 right-1 w-5 h-5 bg-blue-500 rounded-full flex items-center justify-center">
          <Shield className="h-3 w-3 text-white" />
        </div>
      )}
    </button>
  );

  const renderDeclareAttackers = () => (
    <div className="space-y-4">
      <div className="text-center">
        <h3 className="text-lg font-semibold flex items-center justify-center gap-2">
          <Swords className="h-5 w-5" />
          Declare Attackers
        </h3>
        <p className="text-sm text-muted-foreground">
          Select creatures to attack. Click to select or deselect.
        </p>
      </div>

      <Separator />

      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium">Available Attackers</span>
          <Badge variant="outline">
            {selectedAttackers.size} selected
          </Badge>
        </div>
        <ScrollArea className="h-[200px]">
          <div className="flex flex-wrap gap-2 p-1">
            {availableAttackers.map((card) =>
              renderAttackerCard(card, selectedAttackers.has(card.id), () => toggleAttacker(card.id))
            )}
            {availableAttackers.length === 0 && (
              <div className="text-center text-muted-foreground w-full py-8">
                No available attackers
              </div>
            )}
          </div>
        </ScrollArea>
      </div>

      <Separator />

      {selectedAttackers.size > 0 && (
        <div className="bg-muted/50 rounded-lg p-3">
          <span className="text-sm font-medium">Selected Attackers:</span>
          <div className="flex flex-wrap gap-1 mt-1">
            {Array.from(selectedAttackers).map((id) => {
              const card = getAttackerCard(id);
              return card ? (
                <Badge key={id} variant="secondary" className="text-xs">
                  {card.name}
                </Badge>
              ) : null;
            })}
          </div>
        </div>
      )}
    </div>
  );

  const renderDeclareBlockers = () => {
    const attackingCards = Array.from(selectedAttackers).map((id) => getAttackerCard(id)).filter(Boolean) as CombatCard[];

    return (
      <div className="space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-semibold flex items-center justify-center gap-2">
            <Shield className="h-5 w-5" />
            Declare Blockers
          </h3>
          <p className="text-sm text-muted-foreground">
            {selectedAttackerForBlocking
              ? `Select blockers for ${getAttackerCard(selectedAttackerForBlocking)?.name}`
              : "Click an attacker to assign blockers, or click Continue to proceed."}
          </p>
        </div>

        <Separator />

        <div>
          <span className="text-sm font-medium mb-2 block">Attackers</span>
          <ScrollArea className="h-[180px]">
            <div className="flex flex-wrap gap-3 p-1">
              {attackingCards.map((card) => {
                const assignedBlockers = blockerAssignments.get(card.id) || [];
                const isSelected = selectedAttackerForBlocking === card.id;

                return (
                  <div
                    key={card.id}
                    className={cn(
                      "relative border-2 rounded-lg p-2 cursor-pointer transition-all",
                      isSelected
                        ? "border-red-500 bg-red-500/10"
                        : "border-border hover:border-primary/50"
                    )}
                    onClick={() => setSelectedAttackerForBlocking(isSelected ? null : card.id)}
                  >
                    <div className="w-16 h-24 bg-gradient-to-br from-primary/20 to-primary/5 rounded flex flex-col items-center justify-between p-1">
                      <span className="text-[10px] font-medium truncate w-full text-center">{card.name}</span>
                      <span className="text-xs font-bold">{card.power}/{card.toughness}</span>
                    </div>
                    {assignedBlockers.length > 0 && (
                      <div className="absolute -bottom-2 left-0 right-0 flex justify-center">
                        <Badge variant="outline" className="text-xs bg-blue-500/20">
                          {assignedBlockers.length} blocker{assignedBlockers.length > 1 ? "s" : ""}
                        </Badge>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </ScrollArea>
        </div>

        {selectedAttackerForBlocking && (
          <>
            <Separator />
            <div>
              <span className="text-sm font-medium mb-2 block">
                Select Blockers for {getAttackerCard(selectedAttackerForBlocking)?.name}
              </span>
              <div className="flex flex-wrap gap-2">
                {availableBlockers.map((card) => {
                  const isBlocking = (blockerAssignments.get(selectedAttackerForBlocking) || []).includes(card.id);
                  return renderBlockerCard(card, isBlocking, () =>
                    toggleBlocker(selectedAttackerForBlocking, card.id)
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderDamageOrder = () => {
    const attackersWithBlockers = Array.from(blockerAssignments.entries())
      .filter(([_, blockers]) => blockers.length > 1)
      .map(([attackerId]) => getAttackerCard(attackerId))
      .filter(Boolean) as CombatCard[];

    return (
      <div className="space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-semibold flex items-center justify-center gap-2">
            <AlertTriangle className="h-5 w-5" />
            Damage Order
          </h3>
          <p className="text-sm text-muted-foreground">
            {attackersWithBlockers.length > 0
              ? "Order blockers for attackers with multiple blockers"
              : "No attackers have multiple blockers. Click Confirm to proceed."}
          </p>
        </div>

        <Separator />

        {attackersWithBlockers.length > 0 ? (
          <ScrollArea className="h-[300px]">
            <div className="space-y-4">
              {attackersWithBlockers.map((attacker) => {
                const blockers = damageOrder.get(attacker.id) || blockerAssignments.get(attacker.id) || [];

                return (
                  <Card key={attacker.id}>
                    <CardHeader className="pb-2">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <Swords className="h-4 w-4 text-red-500" />
                        {attacker.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="space-y-1">
                        {blockers.map((blockerId, index) => {
                          const blocker = getBlockerCard(blockerId);
                          return blocker ? (
                            <div
                              key={blockerId}
                              className="flex items-center justify-between bg-muted/50 rounded p-2"
                            >
                              <div className="flex items-center gap-2">
                                <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                                <Badge variant="outline" className="text-xs">
                                  {index + 1}
                                </Badge>
                                <span className="text-sm">{blocker.name}</span>
                                <span className="text-xs text-muted-foreground">
                                  ({blocker.power}/{blocker.toughness})
                                </span>
                              </div>
                              <div className="flex gap-1">
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => moveBlockerUp(attacker.id, index)}
                                  disabled={index === 0}
                                >
                                  <ArrowRight className="h-3 w-3 rotate-[-90deg]" />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-6 w-6 p-0"
                                  onClick={() => moveBlockerDown(attacker.id, index)}
                                  disabled={index === blockers.length - 1}
                                >
                                  <ArrowRight className="h-3 w-3 rotate-90" />
                                </Button>
                              </div>
                            </div>
                          ) : null;
                        })}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        ) : (
          <div className="text-center text-muted-foreground py-8">
            No multiple blockers - damage order not needed
          </div>
        )}
      </div>
    );
  };

  const renderConfirm = () => {
    const attackingCards = Array.from(selectedAttackers).map((id) => getAttackerCard(id)).filter(Boolean) as CombatCard[];

    return (
      <div className="space-y-4">
        <div className="text-center">
          <h3 className="text-lg font-semibold flex items-center justify-center gap-2">
            <Check className="h-5 w-5" />
            Confirm Combat
          </h3>
          <p className="text-sm text-muted-foreground">
            Review your combat declarations before confirming.
          </p>
        </div>

        <Separator />

        <div>
          <span className="text-sm font-medium">Attackers:</span>
          <div className="flex flex-wrap gap-2 mt-2">
            {attackingCards.map((card) => (
              <Badge key={card.id} variant="secondary">
                {card.name}
              </Badge>
            ))}
            {attackingCards.length === 0 && (
              <span className="text-muted-foreground text-sm">No attackers</span>
            )}
          </div>
        </div>

        <div>
          <span className="text-sm font-medium">Blockers:</span>
          <div className="mt-2 space-y-2">
            {Array.from(blockerAssignments.entries()).map(([attackerId, blockerIds]) => {
              const attacker = getAttackerCard(attackerId);
              if (!attacker) return null;
              return (
                <div key={attackerId} className="bg-muted/50 rounded p-2">
                  <span className="text-sm font-medium">{attacker.name} is blocked by:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {blockerIds.map((blockerId) => {
                      const blocker = getBlockerCard(blockerId);
                      return blocker ? (
                        <Badge key={blockerId} variant="outline" className="text-xs">
                          {blocker.name}
                        </Badge>
                      ) : null;
                    })}
                  </div>
                </div>
              );
            })}
            {blockerAssignments.size === 0 && selectedAttackers.size > 0 && (
              <span className="text-muted-foreground text-sm">No blockers assigned - attacks go through</span>
            )}
          </div>
        </div>
      </div>
    );
  };

  const canProceed = () => true;

  const getNextButtonText = () => {
    switch (combatPhase) {
      case "declare-attackers":
        return "Continue to Blockers";
      case "declare-blockers":
        return "Continue to Damage Order";
      case "damage-order":
        return "Confirm Combat";
      case "confirm":
        return "Confirm and Proceed";
      default:
        return "Continue";
    }
  };

  const handleNext = () => {
    switch (combatPhase) {
      case "declare-attackers":
        handleProceedToBlockers();
        break;
      case "declare-blockers":
        handleProceedToDamageOrder();
        break;
      case "damage-order":
        onPhaseChange?.("confirm");
        break;
      case "confirm":
        handleConfirm();
        break;
    }
  };

  const handleBack = () => {
    switch (combatPhase) {
      case "declare-blockers":
        onPhaseChange?.("declare-attackers");
        break;
      case "damage-order":
        onPhaseChange?.("declare-blockers");
        break;
      case "confirm":
        onPhaseChange?.("damage-order");
        break;
      default:
        onGoBack?.();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Swords className="h-5 w-5" />
            Combat Declaration
          </DialogTitle>
          <DialogDescription>
            Declare attackers and blockers for combat
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-2">
          <Badge variant={combatPhase === "declare-attackers" ? "default" : "outline"}>
            1. Attackers
          </Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant={combatPhase === "declare-blockers" ? "default" : "outline"}>
            2. Blockers
          </Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant={combatPhase === "damage-order" ? "default" : "outline"}>
            3. Order
          </Badge>
          <ArrowRight className="h-4 w-4 text-muted-foreground" />
          <Badge variant={combatPhase === "confirm" ? "default" : "outline"}>
            4. Confirm
          </Badge>
        </div>

        <div className="flex-1 overflow-y-auto py-4">
          {combatPhase === "declare-attackers" && renderDeclareAttackers()}
          {combatPhase === "declare-blockers" && renderDeclareBlockers()}
          {combatPhase === "damage-order" && renderDamageOrder()}
          {combatPhase === "confirm" && renderConfirm()}
        </div>

        <DialogFooter className="flex-row justify-between sm:justify-between">
          <Button
            variant="outline"
            onClick={handleBack}
            disabled={combatPhase === "declare-attackers" && !onGoBack}
          >
            <RotateCcw className="h-4 w-4 mr-1" />
            Back
          </Button>
          <Button onClick={handleNext} disabled={!canProceed()}>
            {getNextButtonText()}
            <ArrowRight className="h-4 w-4 ml-1" />
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export default CombatDeclaration;
