
"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getDeckReview, SavedDeck, DeckCard, importDecklist } from "@/app/actions";
import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";
import { Bot, Loader2 } from "lucide-react";
import { ReviewDisplay } from "./_components/review-display";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DeckSelector } from "@/components/deck-selector";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { formatRules } from "@/lib/game-rules";

type DeckOption = DeckReviewOutput["deckOptions"][0];

export default function DeckCoachPage() {
  const [decklist, setDecklist] = useState("");
  const [format, setFormat] = useState("commander");
  const [review, setReview] = useState<DeckReviewOutput | null>(null);
  const [originalDeckCards, setOriginalDeckCards] = useState<DeckCard[] | null>(null);
  const [isPending, startTransition] = useTransition();
  const [savedDecks, setSavedDecks] = useLocalStorage<SavedDeck[]>('saved-decks', []);
  const { toast } = useToast();

  const handleReview = () => {
    if (decklist.trim().length === 0) {
      toast({
        variant: "destructive",
        title: "Empty Decklist",
        description: "Please paste your decklist to get a review.",
      });
      return;
    }

    startTransition(async () => {
      try {
        setReview(null);
        
        let initialCards: DeckCard[] = [];
        if (originalDeckCards) {
          initialCards = originalDeckCards;
        } else {
            const { found, notFound, illegal } = await importDecklist(decklist, format);
            if (notFound.length > 0) {
                 toast({
                    variant: "destructive",
                    title: "Some cards not found",
                    description: `Could not process: ${notFound.join(", ")}. Please check spelling.`,
                });
            }
            if (illegal.length > 0) {
                toast({
                   variant: "destructive",
                   title: "Illegal Cards Found",
                   description: `Your deck contains cards not legal in ${format}: ${illegal.join(", ")}.`,
               });
           }
            if (found.length === 0) {
                toast({
                    variant: "destructive",
                    title: "No valid cards found",
                    description: "Could not find any valid cards in the decklist provided.",
                });
                return;
            }
            initialCards = found;
        }
        setOriginalDeckCards(initialCards);

        const result = await getDeckReview({ decklist, format });
        setReview(result);
      } catch (error) {
        toast({
          variant: "destructive",
          title: "Review Failed",
          description: "Could not get a review from the AI coach. Please try again later.",
        });
        console.error(error);
      }
    });
  };
  
  const handleDeckSelect = (deck: SavedDeck) => {
    setFormat(deck.format);
    const decklistStr = deck.cards.map(c => `${c.count} ${c.name}`).join('\n');
    setDecklist(decklistStr);
    setOriginalDeckCards(deck.cards);
    toast({ title: 'Deck Loaded', description: `Loaded "${deck.name}" for review.` });
  };

  const handleSaveNewDeck = async (option: DeckOption, newDeckName: string) => {
    if (!originalDeckCards) return;

    try {
      // 1. Get cards to add and validate them
      const cardsToAddFromAI = option.cardsToAdd || [];
      const cardsToRemoveFromAI = option.cardsToRemove || [];
      
      let cardsToAddFromApi: DeckCard[] = [];
      let notFound: string[] = [];
      let illegal: string[] = [];

      if (cardsToAddFromAI.length > 0) {
        const decklistForImport = cardsToAddFromAI.map(c => `${c.quantity} ${c.name}`).join('\n');
        const importResult = await importDecklist(decklistForImport, format);
        cardsToAddFromApi = importResult.found;
        notFound = importResult.notFound;
        illegal = importResult.illegal;
      }
      
      // 2. Validate the suggestion's integrity
      const intendedAddCount = cardsToAddFromAI.reduce((sum, c) => sum + c.quantity, 0);
      const actualAddCount = cardsToAddFromApi.reduce((sum, c) => sum + c.count, 0);
      const intendedRemoveCount = cardsToRemoveFromAI.reduce((sum, c) => sum + c.quantity, 0);

      const errorMessages = [];
      if (notFound.length > 0) {
        errorMessages.push(`Cards not found: ${notFound.join(", ")}.`);
      }
      if (illegal.length > 0) {
        errorMessages.push(`Illegal cards suggested and ignored: ${illegal.join(", ")}.`);
      }
      if (intendedAddCount !== intendedRemoveCount) {
        errorMessages.push(`The AI suggested adding ${intendedAddCount} cards but removing ${intendedRemoveCount}, which would change the deck size.`);
      } else if (intendedAddCount !== actualAddCount) {
         errorMessages.push(`The AI's suggestions included invalid or illegal cards, which would result in an incorrect deck size.`);
      }

      if (errorMessages.length > 0) {
        toast({
          variant: "destructive",
          title: "AI Suggestion Invalid",
          description: `Could not save new deck. ${errorMessages.join(" ")}`,
        });
        return; // Abort saving
      }

      // 3. If valid, proceed with creating the new deck
      let newDeckList: DeckCard[] = JSON.parse(JSON.stringify(originalDeckCards));

      // Handle Removals
      for (const toRemove of cardsToRemoveFromAI) {
        const cardIndex = newDeckList.findIndex(c => c.name.toLowerCase() === toRemove.name.toLowerCase());
        if (cardIndex > -1) {
          newDeckList[cardIndex].count -= toRemove.quantity;
          if (newDeckList[cardIndex].count <= 0) {
            newDeckList = newDeckList.filter((_, i) => i !== cardIndex);
          }
        }
      }

      // Handle Additions
      for (const card of cardsToAddFromApi) {
        const cardIndex = newDeckList.findIndex(c => c.id === card.id);
        if (cardIndex > -1) {
          newDeckList[cardIndex].count += card.count;
        } else {
          newDeckList.push(card);
        }
      }

      const now = new Date().toISOString();
      const newDeck: SavedDeck = {
        id: crypto.randomUUID(),
        name: newDeckName,
        format,
        cards: newDeckList,
        createdAt: now,
        updatedAt: now,
      };
      
      setSavedDecks(prevDecks => [...prevDecks, newDeck]);
      toast({ 
        title: "New Deck Saved!", 
        description: `"${newDeckName}" has been added to your collection.`
      });

    } catch (error) {
      console.error("Failed to save new deck:", error);
      toast({ variant: "destructive", title: "Save Failed", description: "An error occurred while saving the new deck." });
    }
  };


  return (
    <div className="flex-1 p-4 md:p-6">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">AI Deck Coach</h1>
        <p className="text-muted-foreground mt-1">
          Paste your decklist to get an expert analysis from our AI coach.
        </p>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your Decklist</CardTitle>
            <CardDescription>Select a saved deck or paste one below.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-2 mb-4">
              <DeckSelector onDeckSelect={handleDeckSelect} />
            </div>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-card px-2 text-muted-foreground">
                  Or
                </span>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <Label htmlFor="format-select">Format</Label>
              <Select value={format} onValueChange={setFormat} disabled={isPending}>
                  <SelectTrigger id="format-select" className="capitalize">
                      <SelectValue placeholder="Select format" />
                  </SelectTrigger>
                  <SelectContent>
                      <SelectItem value="commander">Commander</SelectItem>
                      <SelectItem value="standard">Standard</SelectItem>
                      <SelectItem value="modern">Modern</SelectItem>
                      <SelectItem value="pioneer">Pioneer</SelectItem>
                      <SelectItem value="legacy">Legacy</SelectItem>
                      <SelectItem value="vintage">Vintage</SelectItem>
                      <SelectItem value="pauper">Pauper</SelectItem>
                  </SelectContent>
              </Select>
            </div>
            <Textarea
              placeholder="1 Sol Ring&#10;1 Arcane Signet&#10;..."
              className="h-96 font-mono text-sm"
              value={decklist}
              onChange={(e) => {
                setDecklist(e.target.value);
                setOriginalDeckCards(null); // Clear if user edits list manually
              }}
              disabled={isPending}
            />
            <Button onClick={handleReview} disabled={isPending} className="mt-4 w-full">
              {isPending ? (
                <Loader2 className="mr-2 animate-spin" />
              ) : (
                <Bot className="mr-2" />
              )}
              {isPending ? "Analyzing..." : "Review My Deck"}
            </Button>
          </CardContent>
        </Card>
        
        <div className="flex flex-col">
            {isPending && (
                <Card className="flex-1 flex items-center justify-center">
                    <div className="text-center text-muted-foreground">
                        <Loader2 className="mx-auto h-12 w-12 animate-spin text-primary" />
                        <p className="mt-4">The AI coach is analyzing your deck...</p>
                    </div>
                </Card>
            )}
            {!isPending && review && originalDeckCards && (
              <ReviewDisplay 
                review={review} 
                onSaveNewDeck={handleSaveNewDeck} 
              />
            )}
            {!isPending && !review && (
                <Card className="flex-1 flex items-center justify-center border-dashed">
                    <div className="text-center text-muted-foreground">
                        <Bot className="mx-auto h-12 w-12" />
                        <p className="mt-4">Your deck review will appear here.</p>
                    </div>
                </Card>
            )}
        </div>
      </main>
    </div>
  );
}
