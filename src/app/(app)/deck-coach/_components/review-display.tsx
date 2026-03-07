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
import { Loader2 } from "lucide-react";
import { DeckCard } from "@/app/actions";

type DeckOption = DeckReviewOutput["deckOptions"][0];

interface ReviewDisplayProps {
  review: DeckReviewOutput;
  onSaveNewDeck: (option: DeckOption, newDeckName: string) => Promise<void>;
}

export function ReviewDisplay({ review, onSaveNewDeck }: ReviewDisplayProps) {
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

  return (
    <>
      <Card className="h-full">
        <CardHeader>
          <CardTitle>AI Analysis Complete</CardTitle>
          <CardDescription>Here is the coach's feedback and proposed improvements for your deck.</CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-20rem)]">
            <div className="pr-4 space-y-6">
              <div>
                <h3 className="font-headline text-lg font-bold mb-2">Overall Analysis</h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">{review.reviewSummary}</p>
              </div>
              
              {review.deckOptions && review.deckOptions.length > 0 && (
                <div>
                  <h3 className="font-headline text-lg font-bold mb-2">Suggested Deck Options</h3>
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
