/**
 * Draft Complete Page
 *
 * Phase 15: Draft Core - Plan 04
 * Requirements: DRFT-09, DRFT-10, DRFT-11
 *
 * Displays draft completion screen with:
 * - Draft summary (cards picked, set name)
 * - Pool statistics (colors, types, CMC)
 * - Actions: Build Deck, Start New Draft, View Pool
 */

"use client";

import { Suspense, useState, useEffect, useCallback, useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  getDraftSession,
  saveDraftSession,
  countPoolByColor,
  completeSession,
} from "@/lib/limited/pool-storage";
import { isDraftComplete } from "@/lib/limited/draft-generator";
import {
  appendPickRecord,
  buildDraftLogCsvFilename,
  buildDraftLogJsonExport,
  normalizeDraftPickLog,
  serializeDraftLogCsv,
  withNormalizedPickLog,
  DRAFT_LOG_CSV_COLUMNS,
} from "@/lib/limited/draft-log";
import type {
  DraftSession,
  PickRecord,
  PoolCard,
} from "@/lib/limited/types";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import {
  CheckCircle,
  Package,
  Layers,
  RefreshCw,
  Eye,
  Sparkles,
  ArrowRight,
  Download,
  ClipboardCopy,
  Swords,
} from "lucide-react";
import type { DraftPoolViewProps } from "@/components/draft-pool-view";

// ============================================================================
// Constants
// ============================================================================

const MINIMUM_DECK_SIZE = 40;
const MAX_CARD_COPIES = 4;

// ============================================================================
// Component with Suspense wrapper
// ============================================================================

export default function DraftCompletePage() {
  return (
    <Suspense fallback={
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent mb-4" />
        <p className="text-muted-foreground">Loading...</p>
      </div>
    }>
      <DraftCompletePageContent />
    </Suspense>
  );
}

// ============================================================================
// Main Content Component
// ============================================================================

function DraftCompletePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Get session ID from URL
  const sessionId = searchParams.get("session");

  // State
  const [session, setSession] = useState<DraftSession | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);

  const { toast } = useToast();

  // Load session
  useEffect(() => {
    async function loadSession() {
      if (!sessionId) {
        setError("No session ID provided");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        const loadedSession = await getDraftSession(sessionId);

        if (!loadedSession) {
          setError("Session not found");
          setIsLoading(false);
          return;
        }

        if (loadedSession.mode !== "draft") {
          setError("This is not a draft session");
          setIsLoading(false);
          return;
        }

        // Check if draft is actually complete
        if (!isDraftComplete(loadedSession) && loadedSession.draftState !== "draft_complete") {
          // Redirect back to draft page
          router.replace(`/draft?session=${sessionId}`);
          return;
        }

        // Issue #1558: backfill `pickLog` for sessions persisted before
        // the field existed. The IndexedDB schema is unchanged so legacy
        // rows come back without the array; `withNormalizedPickLog` is a
        // defensive guarantee the downstream export pipeline never sees
        // `undefined`.
        const normalized = withNormalizedPickLog(loadedSession);

        // Update session status to completed if not already
        if (normalized.status !== "completed") {
          normalized.status = "completed";
          await saveDraftSession(normalized);
          await completeSession(sessionId);
        }

        setSession(normalized);
      } catch (err) {
        console.error("Failed to load session:", err);
        setError(err instanceof Error ? err.message : "Failed to load session");
      } finally {
        setIsLoading(false);
      }
    }

    loadSession();
  }, [sessionId, router]);

  // Navigate to deck builder
  const handleBuildDeck = useCallback(() => {
    if (session) {
      router.push(`/limited-deck-builder?session=${session.id}`);
    }
  }, [session, router]);

  // Start new draft
  const handleNewDraft = useCallback(() => {
    router.push("/set-browser");
  }, [router]);

  // Export the per-pick log as a CSV file download (issue #1558).
  // The download runs entirely client-side via an in-memory blob URL —
  // no new IO surface, no extra permissions.
  const handleExportCsv = useCallback(() => {
    if (!session) return;
    const csv = serializeDraftLogCsv(session);
    const filename = buildDraftLogCsvFilename(session);
    try {
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      // Append so Firefox actually triggers the download (it ignores
      // detached anchors in some versions).
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      // Free the object URL on the next tick — revoking synchronously
      // can race the browser's download dispatch.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      toast({
        title: "Draft log exported",
        description: `${filename} (${normalizeDraftPickLog(session.pickLog).length} picks)`,
      });
    } catch (err) {
      console.error("Failed to export draft log CSV:", err);
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Unknown error",
        variant: "destructive",
      });
    }
  }, [session, toast]);

  // Copy the draft log as JSON to the clipboard (issue #1558).
  // Falls back to a hidden-textarea + execCommand path when the async
  // Clipboard API isn't supported (e.g. insecure-context HTTP, older
  // browsers). The legacy path keeps the button functional even when the
  // modern API throws.
  const handleCopyJson = useCallback(async () => {
    if (!session) return;
    const payload = buildDraftLogJsonExport(session);
    const text = JSON.stringify(payload, null, 2);

    const tryClipboardWrite = async (): Promise<boolean> => {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        typeof navigator.clipboard.writeText === "function"
      ) {
        try {
          await navigator.clipboard.writeText(text);
          return true;
        } catch {
          return false;
        }
      }
      return false;
    };

    const tryFallback = (): boolean => {
      if (typeof document === "undefined") return false;
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.style.pointerEvents = "none";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        return ok;
      } catch {
        return false;
      }
    };

    const ok = (await tryClipboardWrite()) || tryFallback();
    if (ok) {
      toast({
        title: "Draft log copied to clipboard",
        description: `${payload.pickLog.length} picks, schema ${payload.$schema}`,
      });
    } else {
      toast({
        title: "Copy failed",
        description: "Clipboard access denied",
        variant: "destructive",
      });
    }
  }, [session, toast]);

  // Calculate pool statistics
  const poolStats = session
    ? calculatePoolStats(session.pool)
    : null;

  // Pick log grouped by pack for the per-pick table (issue #1558).
  // Memoized so re-renders triggered by the toast don't recompute the
  // grouping.
  const pickLog = session ? normalizeDraftPickLog(session.pickLog) : [];
  const picksByPack = useMemo(() => groupPicksByPack(pickLog), [pickLog]);

  // Loading state
  if (isLoading) {
    return (
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary mb-4" />
        <p className="text-muted-foreground">Loading draft results...</p>
      </div>
    );
  }

  // Error state
  if (error || !session) {
    return (
      <div className="flex h-full min-h-svh w-full flex-col items-center justify-center p-4">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-muted-foreground mb-4">
              {error || "Session not found"}
            </p>
            <Button onClick={() => router.push("/set-browser")}>
              Return to Set Browser
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // Success state - render completion screen
  return (
    <div className="flex h-full min-h-svh w-full flex-col overflow-auto">
      {/* Hero Section */}
      <div className="w-full bg-gradient-to-b from-primary/10 to-transparent p-6 pb-8">
        <div className="mx-auto max-w-3xl text-center">
          <div className="mb-4 inline-flex h-16 w-16 items-center justify-center rounded-full bg-green-500/20">
            <Sparkles className="h-8 w-8 text-green-500" />
          </div>
          <h1 className="text-4xl font-bold mb-2">Draft Complete!</h1>
          <p className="text-xl text-muted-foreground mb-4">
            {session.setName}
          </p>
          <div className="flex items-center justify-center gap-4">
            <Badge variant="outline" className="text-lg px-4 py-2">
              <Package className="h-4 w-4 mr-2" />
              {session.pool.length} Cards Picked
            </Badge>
            {session.pool.length >= MINIMUM_DECK_SIZE && (
              <Badge variant="default" className="text-lg px-4 py-2 bg-green-600">
                <CheckCircle className="h-4 w-4 mr-2" />
                Ready to Build
              </Badge>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 p-6">
        <div className="mx-auto max-w-3xl space-y-6">
          {/* Stats Cards */}
          {poolStats && (
            <div className="grid gap-4 md:grid-cols-3">
              {/* Color Distribution */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Color Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(poolStats.colorDistribution).map(
                      ([color, count]) => (
                        <div
                          key={color}
                          className="flex items-center justify-between"
                        >
                          <span className="capitalize">
                            {color === "colorless" ? "Colorless" : color}
                          </span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Type Distribution */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Type Distribution
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(poolStats.typeDistribution).map(
                      ([type, count]) => (
                        <div
                          key={type}
                          className="flex items-center justify-between"
                        >
                          <span>{type}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      )
                    )}
                  </div>
                </CardContent>
              </Card>

              {/* Mana Curve */}
              <Card>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    Mana Curve
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2">
                    {Object.entries(poolStats.manaCurve)
                      .sort(([a], [b]) => Number(a) - Number(b))
                      .map(([cmc, count]) => (
                        <div
                          key={cmc}
                          className="flex items-center justify-between"
                        >
                          <span>CMC {cmc}{Number(cmc) === 7 ? "+" : ""}</span>
                          <Badge variant="secondary">{count}</Badge>
                        </div>
                      ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* Actions */}
          <div className="grid gap-4 md:grid-cols-2">
            <Button
              size="lg"
              className="h-auto py-6 text-lg"
              onClick={handleBuildDeck}
            >
              <Layers className="h-5 w-5 mr-2" />
              Build Deck
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
            <Button
              size="lg"
              variant="outline"
              className="h-auto py-6 text-lg"
              onClick={handleNewDraft}
            >
              <RefreshCw className="h-5 w-5 mr-2" />
              Start New Draft
            </Button>
          </div>

          {/* Pool Preview */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Your Pool</CardTitle>
                <Button variant="ghost" size="sm" onClick={handleBuildDeck}>
                  <Eye className="h-4 w-4 mr-2" />
                  View All
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <DraftPoolPreview pool={session.pool} />
            </CardContent>
          </Card>

          {/* Per-pick log + export (issue #1558) */}
          <Card data-testid="draft-log-card">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <CardTitle>Draft Log</CardTitle>
                  <p className="text-sm text-muted-foreground mt-1">
                    Per-pick audit trail — what you picked, what you
                    passed on, and when.{" "}
                    {pickLog.length > 0
                      ? `${pickLog.length} pick${pickLog.length === 1 ? "" : "s"} captured.`
                      : "No per-pick history (legacy session)."}
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleExportCsv}
                    data-testid="draft-log-export-csv"
                    disabled={pickLog.length === 0}
                    aria-label="Export draft log as CSV"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Export CSV
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleCopyJson}
                    data-testid="draft-log-copy-json"
                    aria-label="Copy draft log as JSON to clipboard"
                  >
                    <ClipboardCopy className="h-4 w-4 mr-2" />
                    Copy as JSON
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {pickLog.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-4">
                  This session was started before per-pick logging shipped,
                  so no audit trail is available. The final pool above is
                  still complete.
                </p>
              ) : (
                <ScrollArea className="max-h-[420px] pr-4">
                  <div className="space-y-6">
                    {picksByPack.map(({ packNumber, picks }) => (
                      <section
                        key={packNumber}
                        aria-label={`Pack ${packNumber + 1} picks`}
                        data-testid={`draft-log-pack-${packNumber}`}
                      >
                        <header className="mb-2 flex items-center justify-between">
                          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                            Pack {packNumber + 1}
                          </h3>
                          <Badge variant="secondary">
                            {picks.length} pick{picks.length === 1 ? "" : "s"}
                          </Badge>
                        </header>
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead className="w-16">Pick</TableHead>
                              <TableHead>Card</TableHead>
                              <TableHead className="w-24">Rarity</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {picks.map((record) => (
                              <TableRow
                                key={`${record.packNumber}-${record.packPickIndex}-${record.cardId}`}
                                data-testid={`draft-log-row-${record.pickNumber}`}
                              >
                                <TableCell className="font-mono text-sm">
                                  #{record.pickNumber}
                                </TableCell>
                                <TableCell>
                                  <span className="font-medium">
                                    {record.cardName}
                                  </span>
                                  <span className="ml-2 text-xs text-muted-foreground font-mono">
                                    {record.cardId}
                                  </span>
                                </TableCell>
                                <TableCell>
                                  <RarityBadge rarity={record.rarity} />
                                </TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </section>
                    ))}
                  </div>
                </ScrollArea>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                CSV columns: {DRAFT_LOG_CSV_COLUMNS.join(", ")}. JSON export
                uses schema{" "}
                <code className="font-mono">planar-nexus/draft-log/v1</code>.
              </p>
            </CardContent>
          </Card>

          {/* Tips */}
          <Card className="bg-muted/50">
            <CardContent className="pt-6">
              <div className="space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">
                  Building Your Deck:
                </p>
                <ul className="list-disc list-inside space-y-1">
                  <li>Minimum {MINIMUM_DECK_SIZE} cards required</li>
                  <li>Maximum {MAX_CARD_COPIES} copies of each card (except basic lands)</li>
                  <li>Balance your mana curve for consistent draws</li>
                  <li>aim for 17-18 lands in a 40-card deck</li>
                </ul>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function Loader2({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`animate-spin ${className || ""}`}
    >
      <path d="M21 12a9 9 0 1 1-6.219-8.56" />
    </svg>
  );
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Group the per-pick log by pack number for the Draft Complete page table.
 * Packs are returned in ascending `packNumber` order; picks inside each
 * pack are returned in ascending `packPickIndex` order (which equals
 * ascending `pickNumber` for an in-order draft).
 */
function groupPicksByPack(
  pickLog: PickRecord[],
): Array<{ packNumber: number; picks: PickRecord[] }> {
  const buckets = new Map<number, PickRecord[]>();
  for (const record of pickLog) {
    const list = buckets.get(record.packNumber) ?? [];
    list.push(record);
    buckets.set(record.packNumber, list);
  }
  return Array.from(buckets.entries())
    .sort(([a], [b]) => a - b)
    .map(([packNumber, picks]) => ({
      packNumber,
      picks: [...picks].sort((a, b) => a.pickNumber - b.pickNumber),
    }));
}

/**
 * Map a persisted `PickRecord.rarity` string to a colored chip. We
 * deliberately render strings that aren't members of the canonical
 * `Rarity` set verbatim — legacy rows and fixture data can carry
 * `"L"`, `"basic"`, etc., and silently rewriting them would be a
 * regression. The CSV export already preserves them.
 */
function RarityBadge({ rarity }: { rarity: string }) {
  const tone =
    rarity === "mythic"
      ? "bg-orange-500/20 text-orange-700 dark:text-orange-300 border-orange-500/30"
      : rarity === "rare"
        ? "bg-yellow-500/20 text-yellow-700 dark:text-yellow-300 border-yellow-500/30"
        : rarity === "uncommon"
          ? "bg-slate-400/20 text-slate-700 dark:text-slate-300 border-slate-400/30"
          : rarity === "common"
            ? "bg-stone-500/10 text-stone-700 dark:text-stone-300 border-stone-500/30"
            : "bg-muted text-muted-foreground border-border";
  return (
    <Badge
      variant="outline"
      className={cn("uppercase text-xs font-mono", tone)}
      aria-label={`Rarity ${rarity || "unknown"}`}
    >
      {rarity || "—"}
    </Badge>
  );
}

interface PoolStats {
  colorDistribution: Record<string, number>;
  typeDistribution: Record<string, number>;
  manaCurve: Record<string, number>;
  averageCmc: number;
}

function calculatePoolStats(pool: PoolCard[]): PoolStats {
  const colorDistribution: Record<string, number> = {};
  const typeDistribution: Record<string, number> = {};
  const manaCurve: Record<string, number> = {};
  let totalCmc = 0;
  let creatureCount = 0;
  let instantSorceryCount = 0;
  let otherCount = 0;

  for (const card of pool) {
    // Color distribution
    if (card.colors.length === 0) {
      colorDistribution["colorless"] =
        (colorDistribution["colorless"] || 0) + 1;
    } else {
      for (const color of card.colors) {
        colorDistribution[color] = (colorDistribution[color] || 0) + 1;
      }
    }

    // Mana curve
    const cmc = card.cmc ?? 0;
    const curveKey = cmc >= 7 ? "7" : String(cmc);
    manaCurve[curveKey] = (manaCurve[curveKey] || 0) + 1;
    totalCmc += cmc;

    // Type distribution
    const typeLine = card.type_line || "";
    if (typeLine.includes("Creature")) {
      creatureCount++;
      typeDistribution["Creatures"] = creatureCount;
    } else if (
      typeLine.includes("Instant") ||
      typeLine.includes("Sorcery")
    ) {
      instantSorceryCount++;
      typeDistribution["Instants/Sorceries"] = instantSorceryCount;
    } else {
      otherCount++;
      typeDistribution["Other"] = otherCount;
    }
  }

  return {
    colorDistribution,
    typeDistribution,
    manaCurve,
    averageCmc: pool.length > 0 ? totalCmc / pool.length : 0,
  };
}

// ============================================================================
// Draft Pool Preview Component
// ============================================================================

function DraftPoolPreview({ pool }: { pool: PoolCard[] }) {
  // Group cards by type for preview
  const creatures = pool.filter((c) =>
    (c.type_line || "").includes("Creature")
  );
  const spells = pool.filter(
    (c) =>
      (c.type_line || "").includes("Instant") ||
      (c.type_line || "").includes("Sorcery")
  );
  const other = pool.filter(
    (c) =>
      !(c.type_line || "").includes("Creature") &&
      !(c.type_line || "").includes("Instant") &&
      !(c.type_line || "").includes("Sorcery")
  );

  // Show first few cards from each category
  const previewCards = [
    ...creatures.slice(0, 4),
    ...spells.slice(0, 2),
    ...other.slice(0, 2),
  ].filter(Boolean);

  if (previewCards.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-4">No cards in pool</p>
    );
  }

  return (
    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
      {previewCards.map((card) => (
        <div
          key={card.id}
          className="aspect-[2.5/3.5] rounded-md overflow-hidden bg-muted relative"
          title={card.name}
        >
          {card.image_uris?.normal ? (
            <img
              src={card.image_uris.normal}
              alt={card.name}
              className="w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-xs text-center p-1">
              {card.name}
            </div>
          )}
        </div>
      ))}
      {pool.length > 8 && (
        <div className="aspect-[2.5/3.5] rounded-md bg-muted flex items-center justify-center text-muted-foreground">
          +{pool.length - 8} more
        </div>
      )}
    </div>
  );
}
