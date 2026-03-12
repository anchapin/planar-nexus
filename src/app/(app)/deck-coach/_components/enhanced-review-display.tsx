"use client";

import { useState, useTransition } from "react";
import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Bot } from "lucide-react";
import { ArchetypeBadge } from "./archetype-badge";
import { SynergyList, type SynergyItem as SynergyListItem } from "./synergy-list";
import { MissingSynergies, type MissingSynergyItem } from "./missing-synergies";
import { KeyCards, identifyKeyCards, type KeyCard } from "./key-cards";
import { ExportButton, type CoachReportData } from "./export-button";

type DeckOption = DeckReviewOutput["deckOptions"][0];

interface EnhancedReviewDisplayProps {
  review: DeckReviewOutput;
  onSaveNewDeck: (option: DeckOption, newDeckName: string) => Promise<void>;
  decklist?: string;
}

export function EnhancedReviewDisplay({ review, onSaveNewDeck, decklist }: EnhancedReviewDisplayProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedOption, setSelectedOption] = useState<DeckOption | null>(null);
  const [newDeckName, setNewDeckName] = useState("");
  const [isSaving, startSavingTransition] = useTransition();

  const handleOpenDialog = (option: DeckOption) => {
    setSelectedOption(option);
    setNewDeckName(option.title);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (selectedOption && newDeckName) {
      startSavingTransition(async () => {
        await onSaveNewDeck(selectedOption, newDeckName);
        setDialogOpen(false);
      });
    }
  };

  // Prepare synergy data for display components
  const synergyItems: SynergyListItem[] = (review.synergies?.present || []).map(s => ({
    name: s.name,
    score: s.score,
    cards: s.cards,
    description: s.description,
    category: s.category,
  }));

  const missingSynergyItems: MissingSynergyItem[] = (review.synergies?.missing || []).map(m => ({
    synergy: m.synergy,
    missing: m.missing,
    description: m.description,
    suggestion: m.suggestion,
    impact: m.impact,
  }));

  // Identify key cards from deck
  const deckCards = decklist ? parseDecklist(decklist) : [];
  const keyCards: KeyCard[] = identifyKeyCards(
    review.archetype?.primary || "Unknown",
    synergyItems.map(s => ({ name: s.name, cards: s.cards, score: s.score })),
    deckCards
  );

  // Prepare export data
  const exportData: CoachReportData = {
    archetype: review.archetype ? {
      primary: review.archetype.primary,
      confidence: review.archetype.confidence,
      secondary: review.archetype.secondary,
      secondaryConfidence: review.archetype.secondaryConfidence,
    } : undefined,
    synergies: review.synergies?.present || [],
    missingSynergies: review.synergies?.missing || [],
    keyCards,
    reviewSummary: review.reviewSummary,
    deckOptions: review.deckOptions,
    decklist,
  };

  return (
    <>
      <Card className="h-full">
        <CardHeader className="border-b">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-2 flex-1">
              <CardTitle className="flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                AI Analysis Complete
              </CardTitle>
              <CardDescription>
                Here is the coach's feedback and proposed improvements for your deck.
              </CardDescription>
            </div>
            <ExportButton report={exportData} deckName={review.archetype?.primary || "Deck"} />
          </div>
          
          {/* Archetype Badge */}
          {review.archetype && (
            <div className="mt-4">
              <ArchetypeBadge
                archetype={review.archetype.primary}
                confidence={review.archetype.confidence}
                secondary={review.archetype.secondary}
                secondaryConfidence={review.archetype.secondaryConfidence}
              />
              {review.archetype.description && (
                <p className="text-sm text-muted-foreground mt-2">
                  {review.archetype.description}
                </p>
              )}
            </div>
          )}
        </CardHeader>
        
        <CardContent>
          <ScrollArea className="h-[calc(100vh-24rem)]">
            <div className="pr-4 space-y-6 pt-4">
              {/* Overall Analysis */}
              <div>
                <h3 className="font-headline text-lg font-bold mb-2">Overall Analysis</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{review.reviewSummary}</p>
              </div>

              {/* Key Cards */}
              {keyCards.length > 0 && (
                <KeyCards cards={keyCards} />
              )}

              {/* Synergies */}
              {synergyItems.length > 0 && (
                <SynergyList synergies={synergyItems} />
              )}

              {/* Missing Synergies */}
              {missingSynergyItems.length > 0 && (
                <MissingSynergies missing={missingSynergyItems} />
              )}

              {/* Suggested Deck Options */}
              {review.deckOptions && review.deckOptions.length > 0 && (
                <div>
                  <h3 className="font-headline text-lg font-bold mb-2">Suggested Improvements</h3>
                  <Accordion type="single" collapsible className="w-full">
                    {review.deckOptions.map((option, index) => (
                      <AccordionItem value={`item-${index}`} key={index}>
                        <AccordionTrigger className="font-semibold">{option.title}</AccordionTrigger>
                        <AccordionContent>
                          <p className="text-sm text-muted-foreground whitespace-pre-wrap mb-4">{option.description}</p>

                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm mb-4">
                            {option.cardsToAdd && option.cardsToAdd.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-green-500 mb-1">Cards to Add</h4>
                                <ul className="list-disc pl-5">
                                  {option.cardsToAdd.map(card => (
                                    <li key={`add-${card.name}`}>{card.quantity}x {card.name}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                             {option.cardsToRemove && option.cardsToRemove.length > 0 && (
                              <div>
                                <h4 className="font-semibold text-red-500 mb-1">Cards to Remove</h4>
                                 <ul className="list-disc pl-5">
                                  {option.cardsToRemove.map(card => (
                                    <li key={`remove-${card.name}`}>{card.quantity}x {card.name}</li>
                                  ))}
                                </ul>
                              </div>
                            )}
                          </div>

                          <Button onClick={() => handleOpenDialog(option)} size="sm">
                            Create Deck from Suggestion
                          </Button>
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create New Deck</DialogTitle>
            <DialogDescription>
              Save this suggested deck version as a new deck in your collection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="deck-name">New Deck Name</Label>
            <Input
              id="deck-name"
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              disabled={isSaving}
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={isSaving}>Cancel</Button>
            <Button onClick={handleSave} disabled={isSaving}>
              {isSaving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Save Deck
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Simple decklist parser to extract card names and counts
 */
function parseDecklist(decklist: string): Array<{ name: string; count: number }> {
  const lines = decklist.split('\n').filter(line => line.trim() !== '');
  const cards: Array<{ name: string; count: number }> = [];
  
  for (const line of lines) {
    const match = line.match(/^(\d+)\s+(.+)$/);
    if (match) {
      const [, quantity, name] = match;
      cards.push({
        name: name.trim(),
        count: parseInt(quantity, 10),
      });
    }
  }
  
  return cards;
}
