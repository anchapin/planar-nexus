"use client";

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { getDeckReview } from "@/app/actions";
import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";
import { Bot, Loader2 } from "lucide-react";
import { ReviewDisplay } from "./_components/review-display";

export default function DeckCoachPage() {
  const [decklist, setDecklist] = useState("");
  const [review, setReview] = useState<DeckReviewOutput | null>(null);
  const [isPending, startTransition] = useTransition();
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
        const result = await getDeckReview({ decklist });
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

  return (
    <div className="flex-1 p-4 md:p-6">
      <header className="mb-6">
        <h1 className="font-headline text-3xl font-bold">AI Deck Coach</h1>
        <p className="text-muted-foreground mt-1">
          Paste your Commander decklist to get an expert analysis from our AI coach.
        </p>
      </header>
      <main className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Your Decklist</CardTitle>
          </CardHeader>
          <CardContent>
            <Textarea
              placeholder="1 Sol Ring&#10;1 Arcane Signet&#10;..."
              className="h-96 font-mono text-sm"
              value={decklist}
              onChange={(e) => setDecklist(e.target.value)}
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
            {!isPending && review && <ReviewDisplay review={review} />}
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
