"use client";

import { useState, useTransition } from "react";
import type { MetaAnalysisOutput } from "@/ai/flows/ai-meta-analysis";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Loader2,
  TrendingUp,
  TrendingDown,
  Shield,
  Swords,
  Target,
  Lightbulb,
  AlertTriangle,
} from "lucide-react";
import { DeckCard } from "@/lib/card-database";

interface MetaAnalysisDisplayProps {
  analysis: MetaAnalysisOutput;
  format: string;
  onSaveNewDeck: (
    cardsToAdd: { name: string; quantity: number }[],
    cardsToRemove: { name: string; quantity: number }[],
    newDeckName: string,
  ) => Promise<void>;
  originalDeckCards?: DeckCard[] | null;
}

export function MetaAnalysisDisplay({
  analysis,
  onSaveNewDeck,
  originalDeckCards: _originalDeckCards,
}: MetaAnalysisDisplayProps) {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedCardsToAdd, setSelectedCardsToAdd] = useState<
    { name: string; quantity: number }[]
  >([]);
  const [selectedCardsToRemove, setSelectedCardsToRemove] = useState<
    { name: string; quantity: number }[]
  >([]);
  const [newDeckName, setNewDeckName] = useState("");
  const [isSaving, startSavingTransition] = useTransition();

  // Issue #1564 — surface the heuristic archetype-detection confidence so the
  // user can tell when the engine is guessing. A "weak signal" is anything
  // below the "medium" band; we show an AlertTriangle inline with the badge.
  const detection = analysis.deckArchetypeDetection;
  const detectionLabel = detection
    ? detection.primary.charAt(0).toUpperCase() + detection.primary.slice(1)
    : null;
  const isWeakSignal =
    detection?.confidence.level === "low" ||
    detection?.confidence.level === "none";
  const weakSignalAriaLabel =
    detection?.confidence.level === "none"
      ? "Weak signal: no archetype signals detected — falling back to Midrange"
      : detection?.confidence.level === "low"
        ? "Weak signal: low detection confidence — top two archetypes are closely matched"
        : "";

  const handleOpenDialog = (
    cardsToAdd: { name: string; quantity: number }[],
    cardsToRemove: { name: string; quantity: number }[],
  ) => {
    setSelectedCardsToAdd(cardsToAdd);
    setSelectedCardsToRemove(cardsToRemove);
    setNewDeckName(`${analysis.metaOverview.substring(0, 20)}... Meta Build`);
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (newDeckName && selectedCardsToAdd.length > 0) {
      startSavingTransition(async () => {
        await onSaveNewDeck(
          selectedCardsToAdd,
          selectedCardsToRemove,
          newDeckName,
        );
        setDialogOpen(false);
      });
    }
  };

  return (
    <>
      <Card className="h-full">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Meta Analysis Complete
          </CardTitle>
          <CardDescription>
            AI-powered metagame analysis and optimization suggestions
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[calc(100vh-20rem)]">
            <div className="pr-4 space-y-6">
              {/* Detected Archetype (issue #1564) — shows the heuristic
                  engine's top pick and, when the confidence is weak, an inline
                  "weak signal" indicator next to the archetype name. The
                  aria-label makes the warning discoverable to assistive tech
                  without changing the visual layout of the surrounding text. */}
              {detection && detectionLabel && (
                <div data-testid="detected-archetype">
                  <h3 className="font-headline text-lg font-bold mb-2 flex items-center gap-2">
                    <Target className="h-4 w-4" />
                    Detected Archetype
                  </h3>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant="secondary"
                      data-testid="detected-archetype-badge"
                    >
                      {detectionLabel}
                    </Badge>
                    {isWeakSignal && (
                      <span
                        role="img"
                        aria-label={weakSignalAriaLabel}
                        data-testid="weak-signal-indicator"
                        className="inline-flex items-center text-yellow-600 dark:text-yellow-400"
                      >
                        <AlertTriangle
                          className="h-4 w-4"
                          aria-hidden="true"
                        />
                      </span>
                    )}
                    {detection.runnerUp && (
                      <span
                        className="text-xs text-muted-foreground"
                        data-testid="runner-up"
                      >
                        (runner-up:{" "}
                        {detection.runnerUp.charAt(0).toUpperCase() +
                          detection.runnerUp.slice(1)}
                        )
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Meta Overview */}
              <div>
                <h3 className="font-headline text-lg font-bold mb-2 flex items-center gap-2">
                  <Target className="h-4 w-4" />
                  Metagame Overview
                </h3>
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {analysis.metaOverview}
                </p>
              </div>

              {/* Deck Strengths */}
              <div>
                <h3 className="font-headline text-lg font-bold mb-2 flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-green-500" />
                  Deck Strengths
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  {analysis.deckStrengths.map((strength, index) => (
                    <li
                      key={`strength-${index}`}
                      className="text-sm text-muted-foreground"
                    >
                      {strength}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Deck Weaknesses */}
              <div>
                <h3 className="font-headline text-lg font-bold mb-2 flex items-center gap-2">
                  <TrendingDown className="h-4 w-4 text-red-500" />
                  Deck Weaknesses
                </h3>
                <ul className="list-disc pl-5 space-y-1">
                  {analysis.deckWeaknesses.map((weakness, index) => (
                    <li
                      key={`weakness-${index}`}
                      className="text-sm text-muted-foreground"
                    >
                      {weakness}
                    </li>
                  ))}
                </ul>
              </div>

              {/* Matchup Analysis */}
              {analysis.matchupAnalysis &&
                analysis.matchupAnalysis.length > 0 && (
                  <div>
                    <h3 className="font-headline text-lg font-bold mb-2 flex items-center gap-2">
                      <Swords className="h-4 w-4" />
                      Matchup Analysis
                    </h3>
                    <Accordion type="single" collapsible className="w-full">
                      {analysis.matchupAnalysis.map((matchup, index) => (
                        <AccordionItem value={`matchup-${index}`} key={index}>
                          <AccordionTrigger className="font-semibold">
                            {matchup.archetype}
                          </AccordionTrigger>
                          <AccordionContent>
                            <p className="text-sm text-muted-foreground mb-2">
                              {matchup.recommendation}
                            </p>
                            {matchup.sideboardNotes && (
                              <div className="bg-muted p-2 rounded-md text-sm">
                                <span className="font-semibold">
                                  Sideboard:{" "}
                                </span>
                                <span className="text-muted-foreground">
                                  {matchup.sideboardNotes}
                                </span>
                              </div>
                            )}
                          </AccordionContent>
                        </AccordionItem>
                      ))}
                    </Accordion>
                  </div>
                )}

              {/* Card Suggestions */}
              <div>
                <h3 className="font-headline text-lg font-bold mb-2 flex items-center gap-2">
                  <Shield className="h-4 w-4" />
                  Card Suggestions
                </h3>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Cards to Add */}
                  {analysis.cardSuggestions.cardsToAdd &&
                    analysis.cardSuggestions.cardsToAdd.length > 0 && (
                      <div className="bg-green-500/5 border border-green-500/20 rounded-md p-3">
                        <h4 className="font-semibold text-green-500 mb-2 flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          Cards to Add
                        </h4>
                        <ul className="list-disc pl-4 space-y-2">
                          {analysis.cardSuggestions.cardsToAdd.map(
                            (card, index) => (
                              <li key={`add-${index}`} className="text-sm">
                                <span className="font-medium">
                                  {card.quantity}x {card.name}
                                </span>
                                <p className="text-xs text-muted-foreground">
                                  {card.reason}
                                </p>
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}

                  {/* Cards to Remove */}
                  {analysis.cardSuggestions.cardsToRemove &&
                    analysis.cardSuggestions.cardsToRemove.length > 0 && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-md p-3">
                        <h4 className="font-semibold text-red-500 mb-2 flex items-center gap-1">
                          <TrendingDown className="h-3 w-3" />
                          Cards to Remove
                        </h4>
                        <ul className="list-disc pl-4 space-y-2">
                          {analysis.cardSuggestions.cardsToRemove.map(
                            (card, index) => (
                              <li key={`remove-${index}`} className="text-sm">
                                <span className="font-medium">
                                  {card.quantity}x {card.name}
                                </span>
                                <p className="text-xs text-muted-foreground">
                                  {card.reason}
                                </p>
                              </li>
                            ),
                          )}
                        </ul>
                      </div>
                    )}
                </div>

                {/* Action Button */}
                {analysis.cardSuggestions.cardsToAdd &&
                  analysis.cardSuggestions.cardsToAdd.length > 0 && (
                    <Button
                      onClick={() =>
                        handleOpenDialog(
                          analysis.cardSuggestions.cardsToAdd || [],
                          analysis.cardSuggestions.cardsToRemove || [],
                        )
                      }
                      size="sm"
                      className="mt-4"
                    >
                      Create Deck from Suggestions
                    </Button>
                  )}
              </div>

              {/* Sideboard Suggestions */}
              {analysis.sideboardSuggestions &&
                analysis.sideboardSuggestions.length > 0 && (
                  <div>
                    <h3 className="font-headline text-lg font-bold mb-2 flex items-center gap-2">
                      <Shield className="h-4 w-4" />
                      Sideboard Suggestions
                    </h3>
                    <div className="bg-muted/50 rounded-md p-3">
                      <ul className="list-disc pl-4 space-y-2">
                        {analysis.sideboardSuggestions.map((card, index) => (
                          <li key={`sideboard-${index}`} className="text-sm">
                            <span className="font-medium">
                              {card.quantity}x {card.name}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {card.reason}
                            </p>
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                )}

              {/* Strategic Advice */}
              <div>
                <h3 className="font-headline text-lg font-bold mb-2 flex items-center gap-2">
                  <Lightbulb className="h-4 w-4" />
                  Strategic Advice
                </h3>
                <div className="bg-primary/5 border border-primary/20 rounded-md p-3">
                  <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                    {analysis.strategicAdvice}
                  </p>
                </div>
              </div>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Meta-Optimized Deck</DialogTitle>
            <DialogDescription>
              Save this meta-optimized deck version as a new deck in your
              collection.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="meta-deck-name">New Deck Name</Label>
            <Input
              id="meta-deck-name"
              value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              disabled={isSaving}
            />
            <div className="text-sm text-muted-foreground mt-2">
              <p>
                Adding:{" "}
                {selectedCardsToAdd.reduce((sum, c) => sum + c.quantity, 0)}{" "}
                cards
              </p>
              <p>
                Removing:{" "}
                {selectedCardsToRemove.reduce((sum, c) => sum + c.quantity, 0)}{" "}
                cards
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isSaving}
            >
              Cancel
            </Button>
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
