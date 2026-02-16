"use client";

import * as React from "react";
import { useCardInteractions } from "@/hooks/use-card-interactions";
import { AbilityMenu } from "@/components/ability-menu";
import { TargetingOverlay } from "@/components/targeting-overlay";
import { CardAbility, TargetRequirement } from "@/types/card-interactions";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Hand,
  Target,
  Zap,
  MousePointer,
  Eye,
  Shield,
  Crosshair,
  Info,
} from "lucide-react";

// Demo card data
const DEMO_CARD = {
  id: "demo-card-1",
  name: "Silverblade Paladin",
  types: ["creature", "human", "knight"],
  oracleText:
    "Double strike, vigilance\n{2}{W}: Tap target creature.\n{1}{W}{B}: Destroy target creature blocking or blocked by Silverblade Paladin.",
  power: 2,
  toughness: 2,
  manaCost: "{2}{W}",
  abilities: [
    {
      id: "ability-1",
      name: "Equip",
      text: "{2}: Attach target Equipment you control to target creature you control.",
      manaCost: "{2}",
      additionalCosts: [],
      isActivatable: true,
      hasTargets: true,
      targetRequirements: {
        minTargets: 1,
        maxTargets: 1,
        validTargetTypes: ["creature"],
        canTargetSelf: false,
      },
    } as CardAbility,
    {
      id: "ability-2",
      name: "Second Ability",
      text: "Tap target creature.",
      manaCost: "{W}",
      additionalCosts: ["tap"],
      isActivatable: true,
      hasTargets: true,
      targetRequirements: {
        minTargets: 1,
        maxTargets: 1,
        validTargetTypes: ["creature"],
        canTargetSelf: true,
      },
    } as CardAbility,
  ],
};

// Demo players
const DEMO_PLAYERS = [
  { id: "player-1", name: "You", life: 20, poisonCounters: 0 },
  { id: "player-2", name: "Opponent", life: 18, poisonCounters: 2 },
];

/**
 * Card Interactions Demo Page
 * Demonstrates the click-to-act interface, ability menu, and targeting system
 * Implements issues #25, #26, #27
 */
export default function CardInteractionsDemoPage() {
  // Use the card interactions hook
  const {
    selectedCardId,
    targetingState,
    handleCardClick,
    handleRightClick,
    startTargeting,
    handleTargetSelection,
    confirmTargets,
    cancelTargeting,
    isValidTarget,
    clearSelection,
  } = useCardInteractions({
    onCardInspect: (cardId) => {
      console.log("Inspecting card:", cardId);
    },
    onCardTap: (cardId) => {
      console.log("Tapping/untapping card:", cardId);
    },
    onAbilityActivate: (cardId, abilityIndex) => {
      console.log("Activating ability:", cardId, abilityIndex);
    },
    onTargetSelect: (targetId, targetType) => {
      console.log("Target selected:", targetId, targetType);
    },
    onTargetConfirm: (targets) => {
      console.log("Targets confirmed:", targets);
    },
    onTargetCancel: () => {
      console.log("Targeting cancelled");
    },
  });

  // UI state
  const [showAbilityMenu, setShowAbilityMenu] = React.useState(false);
  const [selectedAbilityForMenu, setSelectedAbilityForMenu] = React.useState<CardAbility[]>([]);
  const [cardNameForMenu, setCardNameForMenu] = React.useState("");
  const [cardTypesForMenu, setCardTypesForMenu] = React.useState<string[]>([]);
  const [eventLog, setEventLog] = React.useState<string[]>([]);

  // Add event to log
  const addEvent = (event: string) => {
    setEventLog((prev) => [event, ...prev].slice(0, 10));
  };

  // Handle ability activation from menu
  const handleAbilityActivate = (abilityIndex: number) => {
    addEvent(`Ability ${abilityIndex} activated on ${cardNameForMenu}`);
    setShowAbilityMenu(false);
  };

  // Handle starting targeting from ability menu
  const handleStartTargetingFromMenu = (abilityIndex: number, requirements?: TargetRequirement) => {
    const ability = selectedAbilityForMenu[abilityIndex];
    addEvent(`Starting targeting for ${ability?.name}`);
    
    startTargeting(
      DEMO_CARD.id,
      ability?.id,
      {
        maxTargets: requirements?.maxTargets ?? 1,
        minTargets: requirements?.minTargets ?? 1,
        validTargetTypes: requirements?.validTargetTypes ?? [],
        canTargetPlayer: requirements?.canTargetSelf ?? false,
      }
    );
  };

  // Demo: Open ability menu
  const handleOpenAbilityMenu = () => {
    setSelectedAbilityForMenu(DEMO_CARD.abilities);
    setCardNameForMenu(DEMO_CARD.name);
    setCardTypesForMenu(DEMO_CARD.types);
    setShowAbilityMenu(true);
    addEvent("Opened ability menu");
  };

  // Handle target confirm
  const handleConfirm = () => {
    addEvent(`Confirmed ${targetingState.selectedTargets.length} target(s)`);
    confirmTargets();
  };

  // Handle target cancel
  const handleCancel = () => {
    addEvent("Cancelled targeting");
    cancelTargeting();
  };

  return (
    <div className="container mx-auto py-8">
      <div className="flex flex-col gap-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold">Card Interactions Demo</h1>
            <p className="text-muted-foreground">
              Demonstrating click-to-act interface, ability menu, and targeting system
            </p>
          </div>
          <Badge variant="outline" className="text-lg">
            Phase 2.2 Issues #25-27
          </Badge>
        </div>

        <Tabs defaultValue="demo" className="w-full">
          <TabsList>
            <TabsTrigger value="demo">Interactive Demo</TabsTrigger>
            <TabsTrigger value="info">Implementation Info</TabsTrigger>
          </TabsList>

          <TabsContent value="demo" className="space-y-6">
            {/* Main Demo Area */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Card Display */}
              <Card className="lg:col-span-2">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Hand className="h-5 w-5" />
                    Card Interaction Area
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {/* Instructions */}
                    <div className="bg-muted p-4 rounded-lg space-y-2">
                      <div className="flex items-center gap-2 font-medium">
                        <Info className="h-4 w-4" />
                        How to use:
                      </div>
                      <ul className="text-sm text-muted-foreground space-y-1">
                        <li>• <strong>Single click</strong> on card to select/inspect</li>
                        <li>• <strong>Double click</strong> on card to tap/untap</li>
                        <li>• <strong>Right click</strong> on card for context menu</li>
                        <li>• Click <strong>"Open Ability Menu"</strong> to see ability menu</li>
                        <li>• Click <strong>"Start Targeting"</strong> to test targeting mode</li>
                      </ul>
                    </div>

                    {/* Demo Card */}
                    <div className="flex flex-col items-center gap-4">
                      <div
                        className={`relative w-48 h-64 bg-gradient-to-br from-amber-100 to-amber-200 dark:from-amber-900 dark:to-amber-800 rounded-lg border-2 shadow-xl cursor-pointer transition-all hover:scale-105 ${
                          selectedCardId === DEMO_CARD.id
                            ? "border-primary ring-2 ring-primary/50"
                            : "border-amber-300 dark:border-amber-700"
                        } ${
                          targetingState.isActive && isValidTarget(DEMO_CARD.id, DEMO_CARD.types)
                            ? "ring-2 ring-primary animate-pulse"
                            : ""
                        }`}
                        onClick={() => {
                          const result = handleCardClick(DEMO_CARD.id);
                          addEvent(`Click: ${result.action} - ${result.message}`);
                        }}
                        onContextMenu={(e) => {
                          const result = handleRightClick(DEMO_CARD.id, e);
                          addEvent(`Right-click: ${result.action}`);
                        }}
                      >
                        <div className="absolute inset-2 flex flex-col">
                          <div className="text-xs font-bold text-center border-b border-amber-400 pb-1">
                            {DEMO_CARD.name}
                          </div>
                          <div className="flex-1 flex items-center justify-center">
                            <Shield className="h-16 w-16 text-amber-400/50" />
                          </div>
                          <div className="text-xs text-center border-t border-amber-400 pt-1">
                            {DEMO_CARD.power}/{DEMO_CARD.toughness}
                          </div>
                        </div>
                      </div>

                      {/* Selection indicator */}
                      {selectedCardId === DEMO_CARD.id && (
                        <Badge variant="default" className="animate-pulse">
                          <MousePointer className="h-3 w-3 mr-1" />
                          Card Selected
                        </Badge>
                      )}

                      {/* Targeting indicator */}
                      {targetingState.isActive && (
                        <Badge variant="destructive" className="animate-pulse">
                          <Crosshair className="h-3 w-3 mr-1" />
                          Targeting Mode Active
                        </Badge>
                      )}

                      {/* Action buttons */}
                      <div className="flex gap-2">
                        <Button onClick={handleOpenAbilityMenu}>
                          <Zap className="h-4 w-4 mr-1" />
                          Open Ability Menu
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => {
                            startTargeting(DEMO_CARD.id, undefined, {
                              maxTargets: 2,
                              minTargets: 1,
                              validTargetTypes: ["creature", "player"],
                              canTargetPlayer: true,
                            });
                            addEvent("Started targeting mode");
                          }}
                        >
                          <Target className="h-4 w-4 mr-1" />
                          Start Targeting
                        </Button>
                        <Button variant="ghost" onClick={clearSelection}>
                          Clear Selection
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* Event Log */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Info className="h-5 w-5" />
                    Event Log
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <ScrollArea className="h-[300px]">
                    <div className="space-y-2">
                      {eventLog.length === 0 ? (
                        <div className="text-muted-foreground text-sm">
                          No events yet. Interact with the card above.
                        </div>
                      ) : (
                        eventLog.map((event, index) => (
                          <div
                            key={index}
                            className="text-sm p-2 bg-muted rounded"
                          >
                            {event}
                          </div>
                        ))
                      )}
                    </div>
                  </ScrollArea>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 w-full"
                    onClick={() => setEventLog([])}
                  >
                    Clear Log
                  </Button>
                </CardContent>
              </Card>
            </div>

            {/* Targeting Test Area */}
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Target className="h-5 w-5" />
                  Targeting Test Zone
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-4">
                  <p className="text-sm text-muted-foreground">
                    These cards can be targeted when targeting mode is active. Try selecting them
                    after starting targeting mode above.
                  </p>
                  <div className="flex gap-4">
                    {[
                      { id: "target-1", name: "Elite Vanguard", types: ["creature"] },
                      { id: "target-2", name: "Island", types: ["land"] },
                      { id: "target-3", name: "Lightning Bolt", types: ["instant"] },
                    ].map((target) => (
                      <div
                        key={target.id}
                        className={`w-32 h-24 bg-gradient-to-br from-slate-100 to-slate-200 dark:from-slate-800 dark:to-slate-700 rounded-md border-2 flex items-center justify-center text-center p-2 cursor-pointer transition-all hover:scale-105 ${
                          targetingState.selectedTargets.some(
                            (t) => t.targetId === target.id
                          )
                            ? "border-primary ring-2 ring-primary/50"
                            : targetingState.isActive
                            ? "border-amber-500 hover:border-amber-400"
                            : "border-slate-300 dark:border-slate-600"
                        }`}
                        onClick={() => {
                          if (targetingState.isActive) {
                            const result = handleTargetSelection(target.id, "card");
                            addEvent(`Target: ${target.name} - ${result.message}`);
                          }
                        }}
                      >
                        <div>
                          <div className="text-xs font-bold">{target.name}</div>
                          <div className="text-xs text-muted-foreground">
                            {target.types.join(", ")}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="info" className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {/* Issue #25 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <MousePointer className="h-5 w-5" />
                    Issue #25: Click-to-Act
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm">Creates click interactions for cards on the battlefield.</p>
                  <Separator />
                  <div className="text-sm space-y-1">
                    <strong>Features:</strong>
                    <ul className="list-disc list-inside text-muted-foreground">
                      <li>Single click for card inspection</li>
                      <li>Double-click to tap/untap</li>
                      <li>Right-click context menu</li>
                      <li>Select card for targeting</li>
                      <li>Visual selection indicators</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>

              {/* Issue #26 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Zap className="h-5 w-5" />
                    Issue #26: Ability Menu
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm">UI for selecting and activating abilities.</p>
                  <Separator />
                  <div className="text-sm space-y-1">
                    <strong>Features:</strong>
                    <ul className="list-disc list-inside text-muted-foreground">
                      <li>Display all activated abilities</li>
                      <li>Show costs and effects</li>
                      <li>Pay cost confirmation</li>
                      <li>Target selection flow</li>
                      <li>Loyalty ability selection</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>

              {/* Issue #27 */}
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Crosshair className="h-5 w-5" />
                    Issue #27: Targeting System
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  <p className="text-sm">Targeting system for spells and abilities.</p>
                  <Separator />
                  <div className="text-sm space-y-1">
                    <strong>Features:</strong>
                    <ul className="list-disc list-inside text-muted-foreground">
                      <li>Highlight valid targets</li>
                      <li>Handle multi-target requirements</li>
                      <li>Target selection confirmation</li>
                      <li>"You" as target</li>
                      <li>Permanent target selection</li>
                    </ul>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Files Created */}
            <Card>
              <CardHeader>
                <CardTitle>Files Created</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                  <div className="bg-muted p-3 rounded">
                    <code className="text-xs">src/types/card-interactions.ts</code>
                    <p className="text-muted-foreground mt-1">
                      Type definitions for card interactions
                    </p>
                  </div>
                  <div className="bg-muted p-3 rounded">
                    <code className="text-xs">src/hooks/use-card-interactions.ts</code>
                    <p className="text-muted-foreground mt-1">
                      Hook for handling card click interactions
                    </p>
                  </div>
                  <div className="bg-muted p-3 rounded">
                    <code className="text-xs">src/components/ability-menu.tsx</code>
                    <p className="text-muted-foreground mt-1">
                      Ability menu component
                    </p>
                  </div>
                  <div className="bg-muted p-3 rounded">
                    <code className="text-xs">src/components/targeting-overlay.tsx</code>
                    <p className="text-muted-foreground mt-1">
                      Targeting overlay component
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Ability Menu */}
        <AbilityMenu
          open={showAbilityMenu}
          onOpenChange={setShowAbilityMenu}
          abilities={selectedAbilityForMenu}
          cardName={cardNameForMenu}
          cardTypes={cardTypesForMenu}
          onAbilityActivate={handleAbilityActivate}
          onStartTargeting={handleStartTargetingFromMenu}
          availableMana={{
            white: 2,
            blue: 1,
            black: 0,
            red: 1,
            green: 0,
            colorless: 3,
          }}
          isTapped={false}
        />

        {/* Targeting Overlay */}
        <TargetingOverlay
          targetingState={targetingState}
          sourceCardName={cardNameForMenu}
          onTargetSelect={(targetId, targetType) => {
            const result = handleTargetSelection(targetId, targetType);
            addEvent(`Target selected: ${result.message}`);
          }}
          onConfirm={handleConfirm}
          onCancel={handleCancel}
          canTargetPlayer={targetingState.canTargetPlayer}
          playerNames={{
            "player-1": "You",
            "player-2": "Opponent",
          }}
          targetablePlayerIds={
            targetingState.canTargetPlayer
              ? DEMO_PLAYERS.map((p) => p.id)
              : []
          }
        />
      </div>
    </div>
  );
}
