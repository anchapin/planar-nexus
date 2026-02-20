
"use client";

import { SavedDeck } from "@/app/actions";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Download, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface SavedDecksListProps {
  savedDecks: SavedDeck[];
  onLoadDeck: (deck: SavedDeck) => void;
  onDeleteDeck: (deckId: string) => void;
  activeDeckId: string | null;
}

export function SavedDecksList({ savedDecks, onLoadDeck, onDeleteDeck, activeDeckId }: SavedDecksListProps) {
  
  const sortedDecks = [...savedDecks].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());

  if (sortedDecks.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4">
        <p>You have no saved decks.</p>
      </div>
    );
  }

  return (
    <ScrollArea className="h-48">
        <ul className="space-y-2 pr-4">
            {sortedDecks.map(deck => (
                <li 
                    key={deck.id}
                    className={cn(
                        "group flex items-center justify-between text-sm p-2 rounded-md hover:bg-secondary",
                        activeDeckId === deck.id && "bg-secondary"
                    )}
                >
                    <div className="flex flex-col">
                        <span className="font-semibold">{deck.name}</span>
                        <span className="text-xs text-muted-foreground capitalize">{deck.format} &middot; {deck.cards.reduce((sum, c) => sum + c.count, 0)} cards</span>
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"
                         aria-hidden={activeDeckId === deck.id ? "false" : "true"}
                    >
                        <Button variant="ghost" size="sm" onClick={() => onLoadDeck(deck)}>
                            <Download className="mr-2 size-4" /> Load
                        </Button>
                        <AlertDialog>
                            <AlertDialogTrigger asChild>
                                <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive">
                                    <Trash2 className="mr-2 size-4" /> Delete
                                </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                                <AlertDialogHeader>
                                    <AlertDialogTitle>Delete "{deck.name}"?</AlertDialogTitle>
                                    <AlertDialogDescription>
                                    This action will permanently delete this deck. This cannot be undone.
                                    </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                                    <AlertDialogAction onClick={() => onDeleteDeck(deck.id)}>Delete</AlertDialogAction>
                                </AlertDialogFooter>
                            </AlertDialogContent>
                        </AlertDialog>
                    </div>
                </li>
            ))}
        </ul>
    </ScrollArea>
  );
}
