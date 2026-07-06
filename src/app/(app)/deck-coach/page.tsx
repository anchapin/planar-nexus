"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getDeckReview, type SavedDeck, type DeckCard } from "@/app/actions";
import { importDecklistClient } from "@/lib/client-card-operations";
import { type Format } from "@/lib/game-rules";
import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";
import {
  analyzeMetaAndSuggest,
  type MetaAnalysisOutput,
} from "@/ai/flows/ai-meta-analysis";
import {
  Bot,
  Loader2,
  TrendingUp,
  MessageSquare,
  History,
  Plus,
  Trash2,
} from "lucide-react";
import { EnhancedReviewDisplay } from "./_components/enhanced-review-display";
import { MetaAnalysisDisplay } from "./_components/meta-analysis-display";
import { MultiDeckComparison } from "./_components/multi-deck-comparison";
import { SessionExportImport } from "./_components/session-export-import";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { DeckSelector } from "@/components/deck-selector";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  CoachReportSkeleton,
  LoadingProgress,
} from "./_components/coach-skeleton";
import { ManaCurveAnalysis } from "@/components/meta/mana-curve";
import { DeckCoachChatPanel } from "@/components/chat";
import { useDeckCoachChat } from "@/hooks/use-deck-coach-chat";
import { DEFAULT_DECK_ID } from "@/lib/coach-conversation-storage";

type DeckOption = DeckReviewOutput["deckOptions"][0];

export default function DeckCoachPage() {
  const [decklist, setDecklist] = useState("");
  const [format, setFormat] = useState<Format>("commander");
  const [focusArchetype, setFocusArchetype] = useState<string>("");
  const [review, setReview] = useState<DeckReviewOutput | null>(null);
  const [metaAnalysis, setMetaAnalysis] = useState<MetaAnalysisOutput | null>(
    null,
  );
  const [originalDeckCards, setOriginalDeckCards] = useState<DeckCard[] | null>(
    null,
  );
  const [isPending, startTransition] = useTransition();
  const [analysisType, setAnalysisType] = useState<
    "review" | "meta" | "chat" | "compare"
  >("review");
  const [, setSavedDecks] = useLocalStorage<SavedDeck[]>("saved-decks", []);
  const { toast } = useToast();

  // The deck currently loaded into the coach (id of the selected saved deck, or
  // "default" when working from a pasted decklist). Coach conversations are
  // scoped to this id so history is per-deck (issue #1074).
  const [selectedDeckId, setSelectedDeckId] = useState<string>(DEFAULT_DECK_ID);

  // Chat state for conversational AI. Passing format + deck cards means each
  // persisted conversation carries its deck context and can be resumed
  // self-contained (issue #1074).
  const {
    messages,
    isLoading: isChatLoading,
    sendMessage,
    cancelGeneration,
    conversations,
    activeConversationId,
    storageNotice,
    resumeConversation,
    startNewConversation,
    removeConversation,
    exportActiveDeckToJSON,
    importFromJSON,
  } = useDeckCoachChat({
    deckId: selectedDeckId,
    format,
    deckCards: originalDeckCards ?? undefined,
  });

  const handleAnalyzeDeck = (type: "review" | "meta") => {
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
        setMetaAnalysis(null);

        let initialCards: DeckCard[] = [];
        if (originalDeckCards) {
          initialCards = originalDeckCards;
        } else {
          const { found, notFound, illegal } = await importDecklistClient(
            decklist,
            undefined,
            format,
          );
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
              description:
                "Could not find any valid cards in the decklist provided.",
            });
            return;
          }
          initialCards = found;
        }
        setOriginalDeckCards(initialCards);

        if (type === "review") {
          const result = await getDeckReview({ decklist, format });
          setReview(result);
        } else {
          const result = await analyzeMetaAndSuggest({
            decklist,
            format,
            focusArchetype: focusArchetype || undefined,
          });
          setMetaAnalysis(result);
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title: type === "review" ? "Review Failed" : "Meta Analysis Failed",
          description:
            "Could not get analysis from the AI coach. Please try again later.",
        });
        console.error(error);
      }
    });
  };

  const handleDeckSelect = (deck: SavedDeck) => {
    setFormat(deck.format);
    setSelectedDeckId(deck.id);
    const decklistStr = deck.cards
      .map((c) => `${c.count} ${c.name}`)
      .join("\n");
    setDecklist(decklistStr);
    setOriginalDeckCards(deck.cards);
    toast({
      title: "Deck Loaded",
      description: `Loaded "${deck.name}" for review.`,
    });
  };

  const handleSaveNewDeck = async (option: DeckOption, newDeckName: string) => {
    if (!originalDeckCards) return;

    try {
      const cardsToAddFromAI = option.cardsToAdd || [];
      const cardsToRemoveFromAI = option.cardsToRemove || [];

      let cardsToAddFromApi: DeckCard[] = [];
      let notFound: string[] = [];
      let illegal: string[] = [];

      if (cardsToAddFromAI.length > 0) {
        const decklistForImport = cardsToAddFromAI
          .map((c) => `${c.quantity} ${c.name}`)
          .join("\n");
        const importResult = await importDecklistClient(
          decklistForImport,
          undefined,
          format,
        );
        cardsToAddFromApi = importResult.found;
        notFound = importResult.notFound;
        illegal = importResult.illegal;
      }

      const intendedAddCount = cardsToAddFromAI.reduce(
        (sum, c) => sum + c.quantity,
        0,
      );
      const actualAddCount = cardsToAddFromApi.reduce(
        (sum, c) => sum + c.count,
        0,
      );
      const intendedRemoveCount = cardsToRemoveFromAI.reduce(
        (sum, c) => sum + c.quantity,
        0,
      );

      const errorMessages = [];
      if (notFound.length > 0) {
        errorMessages.push(`Cards not found: ${notFound.join(", ")}.`);
      }
      if (illegal.length > 0) {
        errorMessages.push(
          `Illegal cards suggested and ignored: ${illegal.join(", ")}.`,
        );
      }
      if (intendedAddCount !== intendedRemoveCount) {
        errorMessages.push(
          `The AI suggested adding ${intendedAddCount} cards but removing ${intendedRemoveCount}, which would change the deck size.`,
        );
      } else if (intendedAddCount !== actualAddCount) {
        errorMessages.push(
          `The AI's suggestions included invalid or illegal cards, which would result in an incorrect deck size.`,
        );
      }

      if (errorMessages.length > 0) {
        toast({
          variant: "destructive",
          title: "AI Suggestion Invalid",
          description: `Could not save new deck. ${errorMessages.join(" ")}`,
        });
        return;
      }

      let newDeckList: DeckCard[] = JSON.parse(
        JSON.stringify(originalDeckCards),
      );

      for (const toRemove of cardsToRemoveFromAI) {
        const cardIndex = newDeckList.findIndex(
          (c) => c.name.toLowerCase() === toRemove.name.toLowerCase(),
        );
        if (cardIndex > -1) {
          newDeckList[cardIndex].count -= toRemove.quantity;
          if (newDeckList[cardIndex].count <= 0) {
            newDeckList = newDeckList.filter((_, i) => i !== cardIndex);
          }
        }
      }

      for (const card of cardsToAddFromApi) {
        const cardIndex = newDeckList.findIndex((c) => c.id === card.id);
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

      setSavedDecks((prevDecks) => [...prevDecks, newDeck]);
      toast({
        title: "New Deck Saved!",
        description: `"${newDeckName}" has been added to your collection.`,
      });
    } catch (error) {
      console.error("Failed to save new deck:", error);
      toast({
        variant: "destructive",
        title: "Save Failed",
        description: "An error occurred while saving the new deck.",
      });
    }
  };

  // Handle save for meta analysis suggestions
  const handleSaveMetaDeck = async (
    cardsToAdd: { name: string; quantity: number }[],
    cardsToRemove: { name: string; quantity: number }[],
    newDeckName: string,
  ) => {
    const option: DeckOption = {
      title: newDeckName,
      description: "Meta-optimized deck version",
      cardsToAdd,
      cardsToRemove,
    };
    await handleSaveNewDeck(option, newDeckName);
  };

  // Handle chat message submission.
  // `sendMessage` streams the coach response token-by-token and renders it
  // progressively (issue #1077); `cancelGeneration` aborts an in-flight stream
  // via the panel's Cancel button.
  const handleChatMessage = async (content: string) => {
    await sendMessage(content);
  };

  return (
    <div className="flex-1 p-4 md:p-6">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">AI Deck Coach</h1>
        <p className="text-muted-foreground mt-1">
          Paste your decklist to get an expert analysis from our AI coach.
        </p>
      </header>

      <Tabs
        value={analysisType}
        onValueChange={(v) =>
          setAnalysisType(v as "review" | "meta" | "chat" | "compare")
        }
        className="mb-4"
      >
        <TabsList>
          <TabsTrigger value="review">Deck Review</TabsTrigger>
          <TabsTrigger value="meta">Meta Analysis</TabsTrigger>
          <TabsTrigger value="compare">Compare Decks</TabsTrigger>
          <TabsTrigger value="chat">
            <MessageSquare className="w-4 h-4 mr-2" />
            Chat
          </TabsTrigger>
        </TabsList>
      </Tabs>

      {/* Compare Decks tab: a self-contained multi-deck flow (issue #1075),
          rendered full-width instead of the single-deck review grid. */}
      {analysisType === "compare" ? (
        <MultiDeckComparison />
      ) : (
      <main className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your Decklist</CardTitle>
            <CardDescription>
              Select a saved deck or paste one below.
            </CardDescription>
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
                <span className="bg-card px-2 text-muted-foreground">Or</span>
              </div>
            </div>
            <div className="space-y-2 mb-4">
              <Label htmlFor="format-select">Format</Label>
              <Select
                value={format}
                onValueChange={(value) => setFormat(value as Format)}
                disabled={isPending}
              >
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

            {analysisType === "meta" && (
              <div className="space-y-2 mb-4">
                <Label htmlFor="archetype-select">
                  Focus Archetype (Optional)
                </Label>
                <Select
                  value={focusArchetype}
                  onValueChange={setFocusArchetype}
                  disabled={isPending}
                >
                  <SelectTrigger id="archetype-select">
                    <SelectValue placeholder="Any archetype" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="">Any archetype</SelectItem>
                    <SelectItem value="control">Control</SelectItem>
                    <SelectItem value="aggro">Aggro</SelectItem>
                    <SelectItem value="midrange">Midrange</SelectItem>
                    <SelectItem value="combo">Combo</SelectItem>
                    <SelectItem value="tribal">Tribal</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            <Textarea
              placeholder="1 Sol Ring&#10;1 Arcane Signet&#10;..."
              className="h-96 font-mono text-sm"
              value={decklist}
              onChange={(e) => {
                setDecklist(e.target.value);
                setOriginalDeckCards(null);
                // Editing the decklist detaches from any saved deck; scope
                // coach history back to the default bucket (issue #1074).
                setSelectedDeckId(DEFAULT_DECK_ID);
              }}
              disabled={isPending}
            />

            <div className="flex gap-2 mt-4">
              <Button
                onClick={() =>
                  handleAnalyzeDeck(
                    analysisType === "chat" ? "review" : analysisType,
                  )
                }
                disabled={isPending || analysisType === "chat"}
                className="flex-1"
              >
                {isPending ? (
                  <Loader2 className="mr-2 animate-spin" />
                ) : analysisType === "review" ? (
                  <Bot className="mr-2" />
                ) : (
                  <TrendingUp className="mr-2" />
                )}
                {isPending
                  ? "Analyzing..."
                  : analysisType === "review"
                    ? "Review My Deck"
                    : "Analyze Meta"}
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-col">
          {/* Loading state with skeleton */}
          {isPending && analysisType === "review" && <CoachReportSkeleton />}

          {/* Loading state for meta analysis */}
          {isPending && analysisType === "meta" && (
            <LoadingProgress message="Analyzing metagame and optimizing your deck..." />
          )}

          {/* Enhanced Review Display with Tabs */}
          {!isPending &&
            review &&
            originalDeckCards &&
            analysisType === "review" && (
              <Tabs defaultValue="review" className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="review" className="flex-1">
                    AI Review
                  </TabsTrigger>
                  <TabsTrigger value="mana-curve" className="flex-1">
                    Mana Curve
                  </TabsTrigger>
                </TabsList>
                <TabsContent value="review">
                  <EnhancedReviewDisplay
                    review={review}
                    onSaveNewDeck={handleSaveNewDeck}
                    decklist={decklist}
                  />
                </TabsContent>
                <TabsContent value="mana-curve">
                  <ManaCurveAnalysis deck={originalDeckCards} />
                </TabsContent>
              </Tabs>
            )}

          {/* Meta Analysis Display */}
          {!isPending && metaAnalysis && analysisType === "meta" && (
            <Tabs defaultValue="meta" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="meta" className="flex-1">
                  Meta Analysis
                </TabsTrigger>
                <TabsTrigger value="mana-curve" className="flex-1">
                  Mana Curve
                </TabsTrigger>
              </TabsList>
              <TabsContent value="meta">
                <MetaAnalysisDisplay
                  analysis={metaAnalysis}
                  format={format}
                  onSaveNewDeck={handleSaveMetaDeck}
                  originalDeckCards={originalDeckCards}
                />
              </TabsContent>
              <TabsContent value="mana-curve">
                {originalDeckCards && (
                  <ManaCurveAnalysis deck={originalDeckCards} />
                )}
              </TabsContent>
            </Tabs>
          )}

          {/* Chat Interface */}
          {analysisType === "chat" && (
            <div className="flex flex-col gap-3">
              {/* Storage degradation notice (quota / unavailable). Non-blocking:
                  the coach keeps working in-session (issue #1074/#1085). */}
              {storageNotice && (
                <div
                  role="status"
                  aria-live="polite"
                  className="rounded-md border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-xs text-yellow-900 dark:text-yellow-200"
                >
                  {storageNotice}
                </div>
              )}

              {/* Conversation history: resume or delete prior sessions, or start
                  a new one. Persists across refresh/restart via IndexedDB
                  (issue #1074). Export/Import lets users move sessions between
                  browsers/machines (issue #1242). The card is always rendered
                  when chat is the active tab so Import is reachable even when
                  there are no conversations yet for the current deck. */}
              {analysisType === "chat" && (
                <div className="rounded-md border bg-card/60 p-2">
                  <div className="mb-2 flex items-center gap-2 px-1">
                    <History className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Recent conversations
                    </span>
                    <button
                      type="button"
                      onClick={startNewConversation}
                      className="ml-auto inline-flex items-center gap-1 rounded-md border border-input bg-background px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent hover:text-accent-foreground"
                      title="Start a new conversation"
                    >
                      <Plus className="h-3 w-3" aria-hidden="true" />
                      New
                    </button>
                  </div>
                  {conversations.length > 0 && (
                    <ul className="max-h-32 space-y-1 overflow-y-auto pr-1">
                      {conversations.map((conv) => {
                        const active = conv.id === activeConversationId;
                        return (
                          <li key={conv.id}>
                            <div
                              className={`group flex items-center gap-1 rounded-md px-2 py-1 text-xs ${
                                active
                                  ? "bg-primary/10 text-primary"
                                  : "hover:bg-accent/50"
                              }`}
                            >
                              <button
                                type="button"
                                onClick={() => resumeConversation(conv.id)}
                                className="flex-1 truncate text-left"
                                title={conv.title}
                              >
                                {conv.title}
                              </button>
                              <button
                                type="button"
                                onClick={() => removeConversation(conv.id)}
                                className="invisible inline-flex items-center rounded p-1 text-muted-foreground hover:text-destructive group-hover:visible"
                                aria-label={`Delete conversation: ${conv.title}`}
                                title="Delete conversation"
                              >
                                <Trash2 className="h-3 w-3" aria-hidden="true" />
                              </button>
                            </div>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {/* Export/Import is always shown when there is any chat
                      history scope, even if the current deck has no
                      conversations yet — Import is still useful for moving
                      sessions in from another machine (#1242). */}
                  <div className="mt-2 flex justify-end border-t border-border/40 pt-2">
                    <SessionExportImport
                      exportActiveDeckToJSON={exportActiveDeckToJSON}
                      importFromJSON={importFromJSON}
                      scopeLabel={
                        selectedDeckId === DEFAULT_DECK_ID
                          ? "default"
                          : selectedDeckId
                      }
                    />
                  </div>
                </div>
              )}

              <DeckCoachChatPanel
                messages={messages}
                isLoading={isChatLoading}
                onSendMessage={handleChatMessage}
                onCancel={cancelGeneration}
              />
            </div>
          )}

          {/* Empty state */}
          {!isPending &&
            !review &&
            !metaAnalysis &&
            analysisType !== "chat" && (
              <Card className="flex-1 flex items-center justify-center border-dashed">
                <div className="text-center text-muted-foreground">
                  <Bot className="mx-auto h-12 w-12" />
                  <p className="mt-4">Your deck analysis will appear here.</p>
                </div>
              </Card>
            )}
        </div>
      </main>
      )}
    </div>
  );
}
