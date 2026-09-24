"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import type { DragEvent } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { type DeckCard, type SavedDeck } from "@/lib/card-database";
import { parseDecklist } from "@/lib/decklist-utils";
import { getAvailableArchetypeNames } from "@/ai/archetype-signatures";
import {
  compareDecksAsync,
  type DeckComparisonEntry,
  type DeckComparisonReport,
} from "@/ai/flows/compare-decks";
import { GitCompareArrows, Loader2, Trophy, X } from "lucide-react";
import { parseDecklistWithErrors } from "@/lib/decklist-utils";
import { cn } from "@/lib/utils";

/** Minimum/maximum decks a user may compare at once. */
const MIN_DECKS = 2;
const MAX_DECKS = 3;

/** Human colour for a win-probability bucket, used in the matrix. */
function probabilityTone(p: number): string {
  if (p >= 0.6) return "text-emerald-600 dark:text-emerald-400 font-semibold";
  if (p <= 0.4) return "text-red-600 dark:text-red-400 font-semibold";
  return "text-muted-foreground";
}

/** Short label for a deck column header (truncates long names). */
function shortName(name: string, max = 14): string {
  return name.length > max ? `${name.slice(0, max - 1)}…` : name;
}

/**
 * Multi-deck comparison + meta-positioning surface (issue #1075).
 *
 * Lets a user pick 2-3 saved decks (optionally plus one meta archetype), then
 * runs the local-first {@link compareDecksAsync} heuristic and renders the
 * projected matchup matrix, per-deck meta-positioning, and a coaching
 * recommendation. No deck-list editing UI is rebuilt here — selection only.
 */
export function MultiDeckComparison() {
  const [savedDecks, , { loading: decksLoading }] = useLocalStorage<
    SavedDeck[]
  >("saved-decks", []);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [metaArchetype, setMetaArchetype] = useState<string>("");
  const [report, setReport] = useState<DeckComparisonReport | null>(null);
  const [isPending, startTransition] = useTransition();
  const [importedDecks, setImportedDecks] = useState<DeckComparisonEntry[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const { toast } = useToast();
  const [manualDeckText, setManualDeckText] = useState<string>("");
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [manualDecks, setManualDecks] = useState<
    Array<{
      id: string;
      name: string;
      cards: Array<{ name: string; quantity: number }>;
    }>
  >([]);

  const handleFileImport = useCallback(async (file: File) => {
    const text = await file.text();
    const { cards } = parseDecklistWithErrors(text);
    const deckCards = cards.map((c) => ({
      id: "",
      name: c.name,
      quantity: c.quantity,
    })) as unknown as DeckCard[];
    const name = file.name.replace(/\.(txt|dec)$/i, "");
    setImportedDecks((prev) => {
      if (prev.length >= MAX_DECKS) return prev;
      return [
        ...prev,
        { id: `imported-${Date.now()}`, name, cards: deckCards },
      ];
    });
  }, []);

  const removeImportedDeck = useCallback((id: string) => {
    setImportedDecks((prev) => prev.filter((d) => d.id !== id));
    setSelectedIds((prev) => prev.filter((sid) => sid !== id));
  }, []);

  const archetypeNames = useMemo(() => getAvailableArchetypeNames(), []);

  const toggleDeck = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      if (checked) {
        if (prev.length >= MAX_DECKS) return prev; // cap enforced in the handler
        return prev.includes(id) ? prev : [...prev, id];
      }
      return prev.filter((x) => x !== id);
    });
  };

  const addManualDeck = () => {
    const trimmed = manualDeckText.trim();
    if (!trimmed) return;
    const parsed = parseDecklist(trimmed);
    if (parsed.length === 0) {
      toast({
        variant: "destructive",
        title: "Could not parse deck",
        description:
          "No cards were recognised. Use '2x Lightning Bolt' format, one card per line.",
      });
      return;
    }
    const id = `manual-${Date.now()}`;
    setManualDecks((prev) => [
      ...prev,
      { id, name: `Deck ${prev.length + 1}`, cards: parsed },
    ]);
    setManualDeckText("");
    toast({
      title: "Deck added",
      description: `Added "${parsed[0].name}" and ${parsed.length - 1} more cards.`,
    });
  };

  const handleFileDrop = async (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const files = Array.from(e.dataTransfer.files);
    const textFile = files.find(
      (f) =>
        f.type === "text/plain" ||
        f.name.endsWith(".txt") ||
        f.name.endsWith(".dek"),
    );
    if (!textFile) {
      toast({
        variant: "destructive",
        title: "Invalid file",
        description: "Please drop a .txt or .dek file containing a deck list.",
      });
      return;
    }
    try {
      const text = await textFile.text();
      const parsed = parseDecklist(text);
      if (parsed.length === 0) {
        toast({
          variant: "destructive",
          title: "Could not parse deck",
          description:
            "The file didn't contain a recognisable deck list format.",
        });
        return;
      }
      const id = `manual-${Date.now()}`;
      setManualDecks((prev) => [
        ...prev,
        { id, name: `Deck ${prev.length + 1}`, cards: parsed },
      ]);
      toast({
        title: "Deck imported",
        description: `Imported ${parsed[0].name} and ${parsed.length - 1} more cards.`,
      });
    } catch {
      toast({
        variant: "destructive",
        title: "Error reading file",
        description: "Could not read the dropped file.",
      });
    }
  };

  const removeManualDeck = (id: string) => {
    setManualDecks((prev) => prev.filter((d) => d.id !== id));
    setSelectedIds((prev) => prev.filter((x) => x !== id));
  };

  const canCompare =
    !isPending &&
    selectedIds.length + (metaArchetype ? 1 : 0) >= MIN_DECKS &&
    selectedIds.length + (metaArchetype ? 1 : 0) <= MAX_DECKS;

  const handleCompare = () => {
    const chosen = savedDecks.filter((d) => selectedIds.includes(d.id));
    const imported = importedDecks.filter(
      (d) => d.id && selectedIds.includes(d.id),
    );
    const entries: DeckComparisonEntry[] = [
      ...chosen.map((d) => ({ id: d.id, name: d.name, cards: d.cards })),
      ...imported,
    ];
    if (metaArchetype) {
      entries.push({
        name: `${metaArchetype} (meta)`,
        archetypeOverride: metaArchetype,
      });
    }

    if (entries.length < MIN_DECKS) {
      toast({
        variant: "destructive",
        title: "Select more decks",
        description: `Pick at least ${MIN_DECKS} decks to compare.`,
      });
      return;
    }

    startTransition(async () => {
      try {
        setReport(null);
        const result = await compareDecksAsync(entries);
        setReport(result);
        if (!result.sufficient) {
          toast({ title: "Comparison", description: result.note });
        }
      } catch (error) {
        console.error("Multi-deck comparison failed:", error);
        toast({
          variant: "destructive",
          title: "Comparison Failed",
          description:
            "Could not produce the comparison report. Please try again.",
        });
      }
    });
  };

  const deckNames = report?.decks.map((d) => d.name) ?? [];

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GitCompareArrows className="h-5 w-5" />
            Compare Decks
          </CardTitle>
          <CardDescription>
            Select 2–3 saved decks (optionally add a meta archetype) to see a
            projected matchup matrix and a meta-positioning recommendation.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div
            className={`relative rounded-md border-2 border-dashed p-4 transition-colors ${
              isDragOver
                ? "border-primary bg-primary/10"
                : "border-muted-foreground/60 hover:border-muted-foreground"
            }`}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragOver(true);
            }}
            onDragLeave={() => setIsDragOver(false)}
            onDrop={handleFileDrop}
          >
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Paste a deck list or drop a .txt / .dek file to add it to the
              comparison
            </p>
            <Textarea
              placeholder={
                "2x Lightning Bolt\n2x Counterspell\n1x Shivan Dragon\n..."
              }
              value={manualDeckText}
              onChange={(e) => setManualDeckText(e.target.value)}
              className="mb-2 min-h-[80px] resize-none font-mono text-xs"
            />
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={addManualDeck}
                disabled={!manualDeckText.trim()}
              >
                Add Deck
              </Button>
              <p className="text-xs text-muted-foreground">
                Paste cards (one per line, e.g.&nbsp;"2x Lightning Bolt")
              </p>
            </div>
          </div>

          {manualDecks.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {manualDecks.map((deck) => {
                const checked = selectedIds.includes(deck.id);
                const disabled = !checked && selectedIds.length >= MAX_DECKS;
                return (
                  <label
                    key={deck.id}
                    className={`flex items-center gap-3 rounded-md border p-3 text-sm transition-colors ${
                      checked
                        ? "border-primary bg-primary/5"
                        : disabled
                          ? "opacity-50"
                          : "hover:bg-accent/50"
                    }`}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(v) => toggleDeck(deck.id, v === true)}
                    />
                    <span className="flex-1 truncate font-medium">
                      {deck.name}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-5 w-5 text-muted-foreground hover:text-destructive"
                      onClick={(e) => {
                        e.preventDefault();
                        removeManualDeck(deck.id);
                      }}
                    >
                      ×
                    </Button>
                  </label>
                );
              })}
            </div>
          )}

          {decksLoading ? (
            <Skeleton className="h-24 w-full rounded-md" />
          ) : savedDecks.length === 0 && importedDecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved decks yet. Build and save a deck first, or import a deck
              file below.
            </p>
          ) : savedDecks.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {savedDecks.map((deck) => {
                const checked = selectedIds.includes(deck.id);
                const disabled = !checked && selectedIds.length >= MAX_DECKS;
                return (
                  <label
                    key={deck.id}
                    className={cn(
                      "flex items-center gap-3 rounded-md border p-3 text-sm transition-colors cursor-pointer",
                      checked
                        ? "border-primary bg-primary/5"
                        : disabled
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-accent/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(v) => toggleDeck(deck.id, v === true)}
                    />
                    <span className="flex-1 truncate font-medium">
                      {deck.name}
                    </span>
                    <Badge variant="outline" className="capitalize">
                      {deck.format}
                    </Badge>
                  </label>
                );
              })}
              {importedDecks.map((deck) => {
                const deckId = deck.id ?? "";
                const checked = selectedIds.includes(deckId);
                const disabled = !checked && selectedIds.length >= MAX_DECKS;
                return (
                  <label
                    key={deckId}
                    className={cn(
                      "flex items-center gap-3 rounded-md border p-3 text-sm transition-colors cursor-pointer",
                      checked
                        ? "border-primary bg-primary/5"
                        : disabled
                          ? "opacity-50 cursor-not-allowed"
                          : "hover:bg-accent/50",
                    )}
                  >
                    <Checkbox
                      checked={checked}
                      disabled={disabled}
                      onCheckedChange={(v) => toggleDeck(deckId, v === true)}
                    />
                    <span className="flex-1 truncate font-medium">
                      {deck.name}
                    </span>
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        removeImportedDeck(deckId);
                      }}
                      className="text-muted-foreground hover:text-destructive ml-1"
                      aria-label={`Remove ${deck.name}`}
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </label>
                );
              })}
            </div>
          ) : null}

          <div
            className={cn(
              "flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-6 transition-colors",
              isDragging
                ? "border-primary bg-primary/5"
                : "border-muted-foreground/25 hover:border-muted-foreground/50",
            )}
            onDragOver={(e) => {
              e.preventDefault();
              setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setIsDragging(false);
              const file = e.dataTransfer.files[0];
              if (file) handleFileImport(file);
            }}
          >
            <p className="text-sm text-muted-foreground mb-3">
              Drag and drop a deck file here, or
            </p>
            <label className="cursor-pointer">
              <input
                type="file"
                accept=".txt,.dec"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) handleFileImport(file);
                  e.target.value = "";
                }}
              />
              <Button variant="outline" size="sm" asChild>
                <span>Upload deck file</span>
              </Button>
            </label>
            <p className="text-xs text-muted-foreground mt-2">
              Supports .txt and .dec files
            </p>
          </div>

          <Separator />

          <div className="space-y-2">
            <Label htmlFor="meta-archetype">
              Add a meta archetype column (optional)
            </Label>
            <Select
              value={metaArchetype}
              onValueChange={(v) => setMetaArchetype(v === "__none__" ? "" : v)}
              disabled={isPending}
            >
              <SelectTrigger id="meta-archetype">
                <SelectValue placeholder="None — compare only my decks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  None — compare only my decks
                </SelectItem>
                {archetypeNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-3">
            <Button onClick={handleCompare} disabled={!canCompare}>
              {isPending ? (
                <Loader2 className="mr-2 animate-spin" />
              ) : (
                <GitCompareArrows className="mr-2" />
              )}
              {isPending ? "Comparing…" : "Compare Decks"}
            </Button>
            <span className="text-xs text-muted-foreground">
              {selectedIds.length + (metaArchetype ? 1 : 0)} / {MAX_DECKS}{" "}
              selected (min {MIN_DECKS})
            </span>
          </div>
        </CardContent>
      </Card>

      {isPending && <Skeleton className="h-64 w-full rounded-md" />}

      {!isPending && report && report.sufficient && (
        <ComparisonReportView report={report} deckNames={deckNames} />
      )}

      {!isPending && report && !report.sufficient && (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {report.note}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** Renders the computed comparison report: matrix, positioning, recommendation. */
function ComparisonReportView({
  report,
  deckNames,
}: {
  report: DeckComparisonReport;
  deckNames: string[];
}) {
  const cellFor = (row: string, col: string) =>
    report.matchupMatrix.find((c) => c.rowDeck === row && c.colDeck === col);

  return (
    <div className="space-y-4">
      {/* Recommendation */}
      <Card className="border-primary/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Trophy className="h-5 w-5 text-amber-500" />
            Recommendation
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p>
            <span className="font-semibold">
              {report.recommendation.bestDeck}
            </span>{" "}
            — {report.recommendation.reasoning}
          </p>
          {report.recommendation.swapsTowardBest && (
            <div className="rounded-md border bg-muted/40 p-3">
              <p className="mb-2 font-medium">
                Pivot {report.recommendation.swapsTowardBest.fromDeck} →{" "}
                {report.recommendation.swapsTowardBest.toDeck}:
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <SwapList
                  title="Board in"
                  items={report.recommendation.swapsTowardBest.cardsToAdd}
                  tone="add"
                />
                <SwapList
                  title="Board out"
                  items={report.recommendation.swapsTowardBest.cardsToRemove}
                  tone="remove"
                />
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {report.recommendation.swapsTowardBest.rationale}
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Meta-positioning ranking */}
      <Card>
        <CardHeader>
          <CardTitle>Meta Positioning</CardTitle>
          <CardDescription>
            Each deck&apos;s projected win-rate vs the field, best first.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...report.metaPositioning]
              .sort((a, b) => a.rank - b.rank)
              .map((p) => (
                <div
                  key={p.name}
                  className="flex flex-col gap-1 rounded-md border p-3 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={p.rank === 1 ? "default" : "secondary"}>
                      #{p.rank}
                    </Badge>
                    <div>
                      <p className="font-medium">{p.name}</p>
                      <p className="text-xs text-muted-foreground capitalize">
                        {p.archetype} · {p.category}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="font-semibold">
                      {Math.round(p.metaScore * 100)}% avg win-rate
                    </p>
                    {p.strengths.length > 0 && (
                      <p className="text-xs text-emerald-600 dark:text-emerald-400">
                        Favoured: {p.strengths.join(", ")}
                      </p>
                    )}
                    {p.weaknesses.length > 0 && (
                      <p className="text-xs text-red-600 dark:text-red-400">
                        Unfavoured: {p.weaknesses.join(", ")}
                      </p>
                    )}
                  </div>
                </div>
              ))}
          </div>
        </CardContent>
      </Card>

      {/* Matchup matrix */}
      <Card>
        <CardHeader>
          <CardTitle>Projected Matchup Matrix</CardTitle>
          <CardDescription>
            Row deck&apos;s estimated win-rate vs each column deck (heuristic
            category model).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-32">Deck ↓ vs →</TableHead>
                  {deckNames.map((col) => (
                    <TableHead key={col} className="text-center">
                      {shortName(col)}
                    </TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {deckNames.map((row) => (
                  <TableRow key={row}>
                    <TableCell className="font-medium">
                      {shortName(row, 18)}
                    </TableCell>
                    {deckNames.map((col) => {
                      const c = cellFor(row, col);
                      const p = c?.winProbability ?? 0;
                      return (
                        <TableCell
                          key={col}
                          className={`text-center ${probabilityTone(p)}`}
                          title={c?.rationale}
                        >
                          {Math.round(p * 100)}%
                        </TableCell>
                      );
                    })}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {/* Overlap */}
      {report.overlaps.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Card Overlap</CardTitle>
            <CardDescription>
              Shared cards between each pair of builds.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {report.overlaps.map((o) => (
              <div
                key={`${o.a}-${o.b}`}
                className="flex items-center justify-between rounded-md border p-2"
              >
                <span className="truncate">
                  <span className="font-medium">{shortName(o.a, 18)}</span>
                  <span className="mx-1 text-muted-foreground">↔</span>
                  <span className="font-medium">{shortName(o.b, 18)}</span>
                </span>
                <Badge variant="outline">{o.overlapPercent}% shared</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/** A small list of add/remove swap cards. */
function SwapList({
  title,
  items,
  tone,
}: {
  title: string;
  items: Array<{ name: string; quantity: number }>;
  tone: "add" | "remove";
}) {
  const toneClass =
    tone === "add"
      ? "text-emerald-600 dark:text-emerald-400"
      : "text-red-600 dark:text-red-400";
  return (
    <div>
      <p className={`mb-1 text-xs font-semibold uppercase ${toneClass}`}>
        {title}
      </p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">No changes</p>
      ) : (
        <ul className="space-y-1 text-sm">
          {items.map((c) => (
            <li key={c.name}>
              <span className="font-mono text-xs text-muted-foreground">
                {c.quantity}×
              </span>{" "}
              {c.name}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
