/**
 * Enhanced deck selector with format validation
 * Shows only valid decks for the lobby format and provides validation feedback
 */

"use client";

import { useState, useEffect } from "react";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { SavedDeck } from "@/app/actions";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "./ui/label";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription } from "./ui/alert";
import { CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { validateDeckForLobby } from "@/lib/format-validator";
import { getFormatDisplayName, type Format } from "@/lib/game-rules";

interface DeckSelectorWithValidationProps {
  onDeckSelect: (deck: SavedDeck, validation: { isValid: boolean; errors: string[] }) => void;
  lobbyFormat: Format;
  selectedDeckId?: string;
  className?: string;
}

export function DeckSelectorWithValidation({
  onDeckSelect,
  lobbyFormat,
  selectedDeckId,
  className,
}: DeckSelectorWithValidationProps) {
  const [savedDecks] = useLocalStorage<SavedDeck[]>("saved-decks", []);
  const [currentDeckId, setCurrentDeckId] = useState<string>(selectedDeckId || "");
  const [validation, setValidation] = useState<{ isValid: boolean; errors: string[] }>({
    isValid: true,
    errors: [],
  });

  const formatName = getFormatDisplayName(lobbyFormat);

  // Get valid decks for the format
  const validDecks = savedDecks.filter((deck) => {
    const result = validateDeckForLobby(deck, lobbyFormat);
    return result.isValid && result.canPlay;
  });

  // Get decks that don't match the format
  const invalidFormatDecks = savedDecks.filter((deck) => {
    const result = validateDeckForLobby(deck, lobbyFormat);
    return result.isValid && !result.canPlay;
  });

  // Get decks with validation errors
  const erroredDecks = savedDecks.filter((deck) => {
    const result = validateDeckForLobby(deck, lobbyFormat);
    return !result.isValid;
  });

  const handleSelect = (deckId: string) => {
    const selectedDeck = savedDecks.find((d) => d.id === deckId);
    if (selectedDeck) {
      setCurrentDeckId(deckId);
      const deckValidation = validateDeckForLobby(selectedDeck, lobbyFormat);
      setValidation({
        isValid: deckValidation.isValid && deckValidation.canPlay,
        errors: [...deckValidation.errors, ...deckValidation.warnings],
      });
      onDeckSelect(selectedDeck, {
        isValid: deckValidation.isValid && deckValidation.canPlay,
        errors: [...deckValidation.errors, ...deckValidation.warnings],
      });
    }
  };

  // Auto-select first valid deck if none selected
  useEffect(() => {
    if (!currentDeckId && validDecks.length > 0) {
      handleSelect(validDecks[0].id);
    }
  }, []);

  return (
    <div className={className}>
      <Label htmlFor="deck-selector">Select Deck for {formatName}</Label>
      <Select
        value={currentDeckId}
        onValueChange={handleSelect}
        disabled={savedDecks.length === 0}
      >
        <SelectTrigger id="deck-selector">
          <SelectValue placeholder="Select a deck..." />
        </SelectTrigger>
        <SelectContent>
          {savedDecks.length === 0 ? (
            <SelectItem value="no-decks" disabled>
              No saved decks found
            </SelectItem>
          ) : (
            <>
              {/* Valid decks */}
              {validDecks.length > 0 && (
                <>
                  {validDecks.map((deck) => (
                    <SelectItem key={deck.id} value={deck.id}>
                      <div className="flex justify-between w-full items-center">
                        <span className="flex items-center gap-2">
                          <CheckCircle2 className="w-3 h-3 text-green-500" />
                          {deck.name}
                        </span>
                        <Badge variant="outline" className="ml-2 text-xs">
                          {deck.format}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}

              {/* Invalid format decks */}
              {invalidFormatDecks.length > 0 && (
                <>
                  {invalidFormatDecks.map((deck) => (
                    <SelectItem key={deck.id} value={deck.id} disabled>
                      <div className="flex justify-between w-full items-center opacity-60">
                        <span className="flex items-center gap-2">
                          <AlertTriangle className="w-3 h-3 text-yellow-500" />
                          {deck.name}
                        </span>
                        <Badge variant="outline" className="ml-2 text-xs">
                          {deck.format}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}

              {/* Errored decks */}
              {erroredDecks.length > 0 && (
                <>
                  {erroredDecks.map((deck) => (
                    <SelectItem key={deck.id} value={deck.id} disabled>
                      <div className="flex justify-between w-full items-center opacity-40">
                        <span className="flex items-center gap-2">
                          <XCircle className="w-3 h-3 text-red-500" />
                          {deck.name}
                        </span>
                        <Badge variant="outline" className="ml-2 text-xs">
                          {deck.format}
                        </Badge>
                      </div>
                    </SelectItem>
                  ))}
                </>
              )}
            </>
          )}
        </SelectContent>
      </Select>

      {/* Validation message */}
      {currentDeckId && (
        <>
          {validation.isValid && validation.errors.length === 0 && (
            <Alert className="mt-2">
              <CheckCircle2 className="w-4 h-4 text-green-500" />
              <AlertDescription className="text-sm">
                This deck is valid for {formatName}
              </AlertDescription>
            </Alert>
          )}

          {validation.errors.length > 0 && (
            <Alert variant="destructive" className="mt-2">
              <XCircle className="w-4 h-4" />
              <AlertDescription>
                <div className="text-sm">
                  <strong>Deck validation errors:</strong>
                  <ul className="mt-1 space-y-1">
                    {validation.errors.map((error, index) => (
                      <li key={index}>• {error}</li>
                    ))}
                  </ul>
                </div>
              </AlertDescription>
            </Alert>
          )}
        </>
      )}

      {/* Deck count summary */}
      <div className="mt-2 text-xs text-muted-foreground">
        {validDecks.length} valid deck{validDecks.length !== 1 ? "s" : ""} for {formatName}
        {invalidFormatDecks.length > 0 && (
          <span>, {invalidFormatDecks.length} wrong format</span>
        )}
        {erroredDecks.length > 0 && <span>, {erroredDecks.length} invalid</span>}
      </div>
    </div>
  );
}
