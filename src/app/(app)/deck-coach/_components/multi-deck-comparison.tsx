"use client";

import { useMemo, useState, useTransition } from "react";
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
import { useToast } from "@/hooks/use-toast";
import { useLocalStorage } from "@/hooks/use-local-storage";
import { type SavedDeck } from "@/app/actions";
import { getAvailableArchetypeNames } from "@/ai/archetype-signatures";
import {
  compareDecksAsync,
  type DeckComparisonEntry,
  type DeckComparisonReport,
} from "@/ai/flows/compare-decks";
import { GitCompareArrows, Loader2, Trophy } from "lucide-react";

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
  const { toast } = useToast();

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

  const canCompare =
    !isPending &&
    selectedIds.length + (metaArchetype ? 1 : 0) >= MIN_DECKS &&
    selectedIds.length + (metaArchetype ? 1 : 0) <= MAX_DECKS;

  const handleCompare = () => {
    const chosen = savedDecks.filter((d) => selectedIds.includes(d.id));
    const entries: DeckComparisonEntry[] = chosen.map((d) => ({
      id: d.id,
      name: d.name,
      cards: d.cards,
    }));
    if (metaArchetype) {
      entries.push({ name: `${metaArchetype} (meta)`, archetypeOverride: metaArchetype });
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
          {decksLoading ? (
            <Skeleton className="h-24 w-full rounded-md" />
          ) : savedDecks.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No saved decks yet. Build and save a deck first, then come back to
              compare builds.
            </p>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {savedDecks.map((deck) => {
                const checked = selectedIds.includes(deck.id);
                const disabled =
                  !checked && selectedIds.length >= MAX_DECKS;
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
                    <Badge variant="outline" className="capitalize">
                      {deck.format}
                    </Badge>
                  </label>
                );
              })}
            </div>
          )}

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
    report.matchupMatrix.find(
      (c) => c.rowDeck === row && c.colDeck === col,
    );

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
            <span className="font-semibold">{report.recommendation.bestDeck}</span>{" "}
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
                    <TableCell className="font-medium">{shortName(row, 18)}</TableCell>
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
