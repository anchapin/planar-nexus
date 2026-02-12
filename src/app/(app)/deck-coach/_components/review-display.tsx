"use client";

import type { DeckReviewOutput } from "@/ai/flows/ai-deck-coach-review";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
        <div className="flex justify-between items-start">
            <div>
                <CardTitle>AI Analysis Complete</CardTitle>
                <CardDescription>Here is the coach's feedback on your deck.</CardDescription>
            </div>
            <Badge variant={review.overallRating === 'Strong' ? 'default' : 'secondary'} className="capitalize">{review.overallRating}</Badge>
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="strategy">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="strategy">Strategy</TabsTrigger>
            <TabsTrigger value="synergies">Synergies</TabsTrigger>
            <TabsTrigger value="weaknesses">Weaknesses</TabsTrigger>
            <TabsTrigger value="suggestions">Suggestions</TabsTrigger>
          </TabsList>
          
          <ScrollArea className="h-[calc(100vh-25rem)] mt-4">
            <div className="pr-4">
                <TabsContent value="strategy">
                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{review.strategySummary}</p>
                </TabsContent>
                <TabsContent value="synergies">
                    <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                        {review.synergies.map((synergy, i) => <li key={i}>{synergy}</li>)}
                    </ul>
                </TabsContent>
                <TabsContent value="weaknesses">
                    <ul className="list-disc pl-5 space-y-2 text-sm text-muted-foreground">
                        {review.weaknesses.map((weakness, i) => <li key={i}>{weakness}</li>)}
                    </ul>
                </TabsContent>
                <TabsContent value="suggestions">
                <Table>
                    <TableHeader>
                    <TableRow>
                        <TableHead className="w-[80px]">Action</TableHead>
                        <TableHead>Card</TableHead>
                        <TableHead>Reason</TableHead>
                    </TableRow>
                    </TableHeader>
                    <TableBody>
                    {review.suggestions.map((s, i) => (
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
                </TabsContent>
            </div>
          </ScrollArea>
        </Tabs>
      </CardContent>
    </Card>
  );
}
