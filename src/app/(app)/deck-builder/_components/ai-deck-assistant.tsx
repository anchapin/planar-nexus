"use client";

import React, { useState } from "react";
import { useSynergy } from "./synergy-context";
import { type ScryfallCard, type DeckCard } from "@/app/actions";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useChat } from "@ai-sdk/react";
import { Sparkles, Plus, Info, Loader2 } from "lucide-react";

interface AIDeckAssistantProps {
  deck: DeckCard[];
  onAddCard: (card: ScryfallCard) => void;
}

/**
 * AIDeckAssistant Component
 * 
 * Provides proactive card suggestions based on the current deck's synergy.
 * Features:
 * - Top 5 synergy-based recommendations
 * - Synergy score and confidence visualization
 * - AI-streamed explanations for "Why?" queries
 * - Direct "Add to Deck" functionality
 */
export function AIDeckAssistant({ deck, onAddCard }: AIDeckAssistantProps) {
  const { topSuggestions, synergyData, isCalculating, error } = useSynergy();
  const [explainingCardId, setExplainingCardId] = useState<string | null>(null);

  const { messages, sendMessage, setMessages, status } = useChat({
    onError: (error) => {
      console.error('Chat error:', error);
    },
  });

  const isLoading = status === 'submitted' || status === 'streaming';

  const handleExplain = async (card: ScryfallCard) => {
    setExplainingCardId(card.id);
    setMessages([]);
    
    const deckCardNames = deck.map(c => c.name).join(", ");
    const prompt = `Explain the synergy between the card '${card.name}' and the current deck which includes: ${deckCardNames}. Focus on mechanical synergy and strategy. Keep it concise (2-3 sentences).`;
    
    // AI SDK v6: sendMessage needs explicit typing, cast to any for now
    await (sendMessage as any)(prompt);
  };

  const suggestions = topSuggestions.slice(0, 5);

  // Helper to extract text content from AI SDK v6 message
  const getMessageContent = (message: any): string => {
    if (!message.content) return '';
    if (typeof message.content === 'string') return message.content;
    if (Array.isArray(message.content)) {
      return message.content
        .filter((part: any) => part.type === 'text')
        .map((part: any) => part.text)
        .join('');
    }
    return '';
  };

  return (
    <Card className="flex flex-col h-full border-primary/20 bg-primary/5">
      <CardHeader className="pb-3 px-4">
        <div className="flex items-center gap-2">
          <Sparkles className="size-5 text-primary animate-pulse" />
          <CardTitle className="text-lg font-headline">AI Assistant</CardTitle>
        </div>
        <CardDescription className="text-[11px]">
          Smart suggestions based on your current deck.
        </CardDescription>
      </CardHeader>
      
      <CardContent className="p-0 flex-grow">
        {isCalculating && suggestions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-10 text-muted-foreground">
            <Loader2 className="size-8 animate-spin mb-2" />
            <p className="text-xs">Analyzing synergies...</p>
          </div>
        ) : error ? (
          <div className="p-4 text-center text-xs text-destructive">
            {error}
          </div>
        ) : suggestions.length === 0 ? (
          <div className="p-10 text-center text-xs text-muted-foreground">
            {deck.length === 0 
              ? "Add cards to your deck to get AI suggestions." 
              : "No suggestions found for current deck."}
          </div>
        ) : (
          <ScrollArea className="h-full">
            <div className="p-4 space-y-4">
              {suggestions.map((card) => {
                const synergy = synergyData.get(card.id);
                const isExplaining = explainingCardId === card.id;
                const assistantMessage = messages.find(m => m.role === "assistant");
                const explanation = isExplaining && assistantMessage ? getMessageContent(assistantMessage) : null;

                return (
                  <Card key={card.id} className="overflow-hidden border-primary/10 bg-card/50">
                    <CardHeader className="p-3 pb-0">
                      <div className="flex justify-between items-start gap-1">
                        <h4 className="font-bold text-xs leading-tight line-clamp-1">{card.name}</h4>
                        <Badge 
                          variant={
                            synergy?.confidence === "high" ? "default" : 
                            synergy?.confidence === "medium" ? "secondary" : "outline"
                          }
                          className="text-[9px] h-3.5 px-1 capitalize whitespace-nowrap"
                        >
                          {synergy?.confidence || "low"}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <Progress value={synergy?.score || 0} className="h-1.5 flex-grow" />
                        <span className="text-[10px] font-medium min-w-[30px] text-right">
                          {Math.round(synergy?.score || 0)}%
                        </span>
                      </div>
                    </CardHeader>
                    
                    <CardContent className="p-3 pt-2 space-y-2">
                      <div className="text-[10px] text-muted-foreground line-clamp-1">
                        {card.type_line} • {card.mana_cost}
                      </div>
                      
                      {isExplaining && (isLoading || explanation) && (
                        <div className="bg-primary/10 rounded-md p-2 text-[11px] italic text-primary-foreground/90 border border-primary/20 animate-in fade-in slide-in-from-top-1 duration-200">
                          {isLoading && !explanation ? (
                            <div className="flex items-center gap-2">
                              <Loader2 className="size-3 animate-spin" />
                              <span>Analyzing synergy...</span>
                            </div>
                          ) : (
                            <p className="leading-relaxed">{explanation}</p>
                          )}
                        </div>
                      )}
                    </CardContent>
                    
                    <CardFooter className="p-3 pt-0 flex gap-2">
                      <Button 
                        size="sm" 
                        variant="ghost" 
                        className="h-7 text-[10px] flex-grow font-semibold hover:bg-primary/10 hover:text-primary"
                        onClick={() => handleExplain(card)}
                        disabled={isLoading && explainingCardId === card.id}
                      >
                        <Info className="size-3 mr-1" />
                        Why this card?
                      </Button>
                      <Button 
                        size="sm" 
                        variant="default"
                        className="h-7 text-[10px] flex-grow font-semibold"
                        onClick={() => onAddCard(card)}
                      >
                        <Plus className="size-3 mr-1" />
                        Add to Deck
                      </Button>
                    </CardFooter>
                  </Card>
                );
              })}
            </div>
          </ScrollArea>
        )}
      </CardContent>
    </Card>
  );
}
