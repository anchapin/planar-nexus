"use client";

import React, { useState } from 'react';
import { 
  Dialog, 
  DialogContent, 
  DialogDescription, 
  DialogHeader, 
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import { Save } from 'lucide-react';
import { 
  CounterDeckCard 
} from './CounterDeckCard';
import { SideboardPlanEditor } from './sideboard';
import { 
  getCounterRecommendations, 
  getSideboardRecommendations, 
  getManaBaseRecommendations,
  CounterRecommendation,
  ManaBaseRecommendation,
  SideboardCard
} from '@/lib/anti-meta';
import { DeckArchetype, MagicFormat } from '@/lib/meta';

interface AntiMetaRecommendationsProps {
  archetype: DeckArchetype;
  format: MagicFormat;
  trigger?: React.ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}

/**
 * Component displaying anti-meta recommendations for a specific archetype
 */
export function AntiMetaRecommendations({ 
  archetype, 
  format, 
  trigger,
  open,
  onOpenChange 
}: AntiMetaRecommendationsProps) {
  const [selectedCounter, setSelectedCounter] = useState<CounterRecommendation | null>(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [prefillData, setPrefillData] = useState<{
    format?: MagicFormat;
    archetypeId?: string;
    archetypeName?: string;
    opponentArchetypeId?: string;
    opponentArchetypeName?: string;
    inCards?: SideboardCard[];
    outCards?: SideboardCard[];
  } | undefined>(undefined);

  const counterRecommendations = getCounterRecommendations(archetype.id, format);
  const manaBaseRec = getManaBaseRecommendations(archetype.id, format);

  const handleSaveAsCustomPlan = (counter: CounterRecommendation) => {
    const sideboard = getSideboardRecommendations(archetype.id, counter.counterArchetypeId, format);
    setPrefillData({
      format,
      archetypeId: archetype.id,
      archetypeName: archetype.name,
      opponentArchetypeId: counter.counterArchetypeId,
      opponentArchetypeName: counter.counterArchetypeName,
      inCards: sideboard?.in || [],
      outCards: sideboard?.out || [],
    });
    setEditorOpen(true);
  };

  const defaultTrigger = (
    <Button variant="outline" size="sm">
      Get Counter Advice
    </Button>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {trigger || defaultTrigger}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Counter Recommendations</DialogTitle>
          <DialogDescription>
            Best decks to beat {archetype.name} in {format}
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="counters" className="flex-1 overflow-hidden flex flex-col">
          <TabsList className="grid w-full grid-cols-3">
            <TabsTrigger value="counters">Counters</TabsTrigger>
            <TabsTrigger value="sideboard">Sideboard</TabsTrigger>
            <TabsTrigger value="mana">Mana Base</TabsTrigger>
          </TabsList>

          {/* Counter Decks Tab */}
          <TabsContent value="counters" className="flex-1 overflow-hidden">
            <ScrollArea className="h-[400px] pr-4">
              {counterRecommendations.length > 0 ? (
                <div className="grid gap-4">
                  {counterRecommendations.map((counter, index) => (
                    <CounterDeckCard
                      key={index}
                      recommendation={counter}
                      onViewDetails={setSelectedCounter}
                    />
                  ))}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No counter recommendations available for this archetype.</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Sideboard Tab */}
          <TabsContent value="sideboard" className="flex-1 overflow-hidden">
            <ScrollArea className="h-[400px] pr-4">
              {counterRecommendations.length > 0 ? (
                <div className="space-y-4">
                  {counterRecommendations.map((counter, index) => {
                    const sideboard = getSideboardRecommendations(
                      archetype.id,
                      counter.counterArchetypeId,
                      format
                    );
                    return (
                      <Card key={index}>
                        <CardHeader className="pb-2">
                          <div className="flex items-center justify-between">
                            <CardTitle className="text-base">
                              vs {counter.counterArchetypeName}
                            </CardTitle>
                            <Button 
                              variant="ghost" 
                              size="sm"
                              onClick={() => handleSaveAsCustomPlan(counter)}
                            >
                              <Save className="h-4 w-4 mr-1" />
                              Save Plan
                            </Button>
                          </div>
                        </CardHeader>
                        <CardContent>
                          {sideboard && (
                            <div className="space-y-3">
                              <div>
                                <span className="text-sm font-medium text-green-600">In:</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {sideboard.in.map((card, i) => (
                                    <Badge key={i} variant="outline" className="bg-green-50">
                                      {card.cardName} ({card.count})
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              <div>
                                <span className="text-sm font-medium text-red-600">Out:</span>
                                <div className="flex flex-wrap gap-1 mt-1">
                                  {sideboard.out.map((card, i) => (
                                    <Badge key={i} variant="outline" className="bg-red-50">
                                      {card.cardName} ({card.count})
                                    </Badge>
                                  ))}
                                </div>
                              </div>
                              <p className="text-sm text-muted-foreground">
                                {sideboard.notes}
                              </p>
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    );
                  })}
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No sideboard recommendations available.</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>

          {/* Mana Base Tab */}
          <TabsContent value="mana" className="flex-1 overflow-hidden">
            <ScrollArea className="h-[400px] pr-4">
              {manaBaseRec ? (
                <Card>
                  <CardHeader>
                    <CardTitle>Mana Base for {manaBaseRec.archetypeName}</CardTitle>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {/* Land Count */}
                    <div>
                      <span className="text-sm font-medium">Recommended Lands:</span>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-2xl font-bold">
                          {manaBaseRec.recommendedLands}
                        </span>
                        <span className="text-muted-foreground">
                          ({manaBaseRec.manaCurve.minLands}-{manaBaseRec.manaCurve.maxLands} range)
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground mt-1">
                        {manaBaseRec.manaCurve.reasoning}
                      </p>
                    </div>

                    <Separator />

                    {/* Color Requirements */}
                    <div>
                      <span className="text-sm font-medium">Color Sources:</span>
                      <div className="space-y-2 mt-2">
                        {manaBaseRec.colorRequirements.map((req, index) => (
                          <div key={index} className="flex justify-between items-center">
                            <Badge variant="outline">
                              {req.color}
                            </Badge>
                            <span className="text-sm">
                              {req.sources} sources - {req.notes}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>

                    <Separator />

                    {/* Notes */}
                    <div>
                      <span className="text-sm font-medium">Notes:</span>
                      <p className="text-sm text-muted-foreground mt-1">
                        {manaBaseRec.notes}
                      </p>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <p>No mana base recommendations available for this archetype.</p>
                </div>
              )}
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>

      {/* Sideboard Plan Editor */}
      <SideboardPlanEditor
        open={editorOpen}
        onOpenChange={setEditorOpen}
        defaultValues={prefillData}
        onSave={(plan) => {
          console.log('Saved sideboard plan:', plan);
        }}
      />
    </Dialog>
  );
}

export default AntiMetaRecommendations;
