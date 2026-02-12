"use client";

import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

interface ReviewDisplayProps {
  review: DeckReviewOutput;
}

export function ReviewDisplay({ review }: ReviewDisplayProps) {

  return (
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
                        <p className="text-sm text-muted-foreground whitespace-pre-wrap">{option.description}</p>
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
  );
}
