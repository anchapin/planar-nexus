"use client";

import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { ArrowDown, ArrowUp, Replace } from "lucide-react";

interface ReviewDisplayProps {
  review: DeckReviewOutput;
}

export function ReviewDisplay({ review }: ReviewDisplayProps) {

  const getActionIcon = (action: 'add' | 'remove' | 'replace') => {
    switch(action) {
      case 'add': return <ArrowUp className="size-4 text-green-500" />;
      case 'remove': return <ArrowDown className="size-4 text-red-500" />;
      case 'replace': return <Replace className="size-4 text-blue-500" />;
    }
  }

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
                        <p className="text-sm text-muted-foreground mb-4">{option.description}</p>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-[80px]">Action</TableHead>
                              <TableHead>Card</TableHead>
                              <TableHead>Reason</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {option.changes.map((s, i) => (
                              <TableRow key={i}>
                                <TableCell className="capitalize font-medium flex items-center gap-2">
                                   {getActionIcon(s.action)} {s.action}
                                </TableCell>
                                <TableCell>
                                    {s.action === 'remove' && s.cardToChange}
                                    {s.action === 'add' && <span className="text-green-400">{s.suggestedCard}</span>}
                                    {s.action === 'replace' && (
                                        <div>
                                            <span className="line-through">{s.cardToChange}</span> → <span className="text-green-400">{s.suggestedCard}</span>
                                        </div>
                                    )}
                                </TableCell>
                                <TableCell className="text-muted-foreground">{s.reason}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
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
