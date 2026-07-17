"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Slider } from "@/components/ui/slider";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import {
  Dices,
  Play,
  Copy,
  Check,
  HandCoins,
  TrendingUp,
  Percent,
  Sigma,
} from "lucide-react";
import type { DeckCard } from "@/app/actions";
import type { Format } from "@/lib/game-rules";
import { formatRules } from "@/lib/game-rules";
import {
  buildSimulationDeck,
  runGoldfishSimulation,
  formatGoldfishSummary,
  type GoldfishStats,
} from "@/lib/goldfish-simulator";

/** Hard floor: an opening hand cannot be dealt from fewer than this many cards. */
const MIN_DEALABLE_CARDS = 7;

export interface GoldfishSimulatorProps {
  deck: DeckCard[];
  sideboard?: DeckCard[];
  format: Format;
  /**
   * Incremented by the parent (via the `H` deck-builder shortcut) to request a
   * fresh random draw. Each change re-runs the simulation with a new seed.
   */
  drawTrigger?: number;
  className?: string;
}

/**
 * Opening-hand goldfish simulator panel (issue #1439).
 *
 * Runs a seeded, deterministic sample of opening hands from the current deck
 * against a passive opponent and reports mana-curve / playability statistics:
 * average opening lands (+ stddev), a 0–7 land histogram, mulligan rate, and
 * per-CMC on-curve cast percentage. Renders an empty-state guard when the deck
 * is too small to deal a hand.
 */
export function GoldfishSimulator({
  deck,
  sideboard = [],
  format,
  drawTrigger = 0,
  className,
}: GoldfishSimulatorProps) {
  const [seed, setSeed] = useState<number>(() => Date.now());
  const [seedInput, setSeedInput] = useState<string>(() => String(seed));
  const [sampleSize, setSampleSize] = useState<number>(100);
  const [turns, setTurns] = useState<number>(6);
  const [onThePlay, setOnThePlay] = useState<boolean>(true);
  const [includeSideboard, setIncludeSideboard] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  const totalCards = useMemo(
    () => deck.reduce((sum, c) => sum + (c.count || 0), 0),
    [deck],
  );
  const sideboardCardCount = sideboard.reduce(
    (sum, c) => sum + (c.count || 0),
    0,
  );
  const formatMinCards = formatRules[format]?.minCards;

  const simDeck = useMemo(
    () => buildSimulationDeck(deck, sideboard, includeSideboard),
    [deck, sideboard, includeSideboard],
  );

  const canSimulate = totalCards >= MIN_DEALABLE_CARDS;

  // The simulation is pure and cheap (hundreds of trials in a few ms), so
  // derive stats directly from the current parameters via useMemo rather than
  // an effect. This keeps the component side-effect-free during render and
  // recomputes deterministically whenever the deck, seed, or sample parameters
  // change. Same seed → identical results.
  const stats = useMemo<GoldfishStats | null>(() => {
    if (!canSimulate) return null;
    try {
      return runGoldfishSimulation(simDeck, {
        iterations: sampleSize,
        seed,
        turns,
        onThePlay,
      });
    } catch {
      return null;
    }
  }, [canSimulate, simDeck, seed, sampleSize, turns, onThePlay]);

  const applySeed = useCallback((nextSeed: number) => {
    setSeed(nextSeed);
    setSeedInput(String(nextSeed));
    setCopied(false);
  }, []);

  // `H` shortcut: a fresh random draw whenever the parent bumps drawTrigger.
  useEffect(() => {
    if (drawTrigger === 0) return;
    applySeed(Date.now());
  }, [drawTrigger, applySeed]);

  const handleRunClick = useCallback(() => {
    applySeed(parseSeed(seedInput));
  }, [applySeed, seedInput]);

  const handleDrawClick = useCallback(() => {
    applySeed(Date.now());
  }, [applySeed]);

  const handleCopy = useCallback(async () => {
    if (!stats) return;
    const text = formatGoldfishSummary(stats);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }, [stats]);

  // ---- Empty-state guard: too few cards to deal a hand ---------------------
  if (!canSimulate) {
    return (
      <Card className={className} data-testid="goldfish-guard">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Dices className="w-5 h-5" aria-hidden="true" />
            Hand Test
          </CardTitle>
          <CardDescription>
            Sample opening hands and simulate your mana curve against a
            goldfish.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground" role="status">
            Add at least {MIN_DEALABLE_CARDS} cards to your deck to sample an
            opening hand
            {formatMinCards ? ` (${format} requires ${formatMinCards})` : ""}.
          </p>
        </CardContent>
      </Card>
    );
  }

  const maxHistogram = stats ? Math.max(1, ...stats.landHistogram) : 1;

  return (
    <div
      className={cn("space-y-4", className)}
      data-testid="goldfish-simulator"
    >
      {/* Controls */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between gap-2">
            <CardTitle className="text-lg flex items-center gap-2">
              <Dices className="w-5 h-5" aria-hidden="true" />
              Hand Test
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant="secondary"
                onClick={handleDrawClick}
                aria-label="Draw another opening hand (shortcut H)"
              >
                <Dices className="w-4 h-4" aria-hidden="true" />
                Draw
              </Button>
              <Button
                size="sm"
                onClick={handleRunClick}
                aria-label="Run goldfish simulation"
              >
                <Play className="w-4 h-4" aria-hidden="true" />
                Run
              </Button>
            </div>
          </div>
          <CardDescription>
            Seed a deterministic sample of opening hands vs. a passive opponent.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="goldfish-seed">Seed</Label>
              <Input
                id="goldfish-seed"
                inputMode="numeric"
                value={seedInput}
                onChange={(e) => setSeedInput(e.target.value)}
                aria-describedby="goldfish-seed-help"
              />
              <p
                id="goldfish-seed-help"
                className="text-xs text-muted-foreground"
              >
                Same seed reproduces the same hands.
              </p>
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label htmlFor="goldfish-samples">Samples: {sampleSize}</Label>
              </div>
              <Slider
                id="goldfish-samples"
                min={10}
                max={1000}
                step={10}
                value={[sampleSize]}
                onValueChange={(v) => setSampleSize(v[0] ?? 100)}
                aria-label="Number of simulated opening hands"
              />
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="goldfish-turns">Turns simulated: {turns}</Label>
              <Slider
                id="goldfish-turns"
                min={3}
                max={10}
                step={1}
                value={[turns]}
                onValueChange={(v) => setTurns(v[0] ?? 6)}
                aria-label="Number of turns to simulate"
              />
            </div>
            <div className="flex items-center gap-6 pt-5">
              <div className="flex items-center gap-2">
                <Switch
                  id="goldfish-play"
                  checked={onThePlay}
                  onCheckedChange={setOnThePlay}
                  aria-label="On the play"
                />
                <Label htmlFor="goldfish-play" className="cursor-pointer">
                  On the play
                </Label>
              </div>
              {sideboardCardCount > 0 && (
                <div className="flex items-center gap-2">
                  <Switch
                    id="goldfish-sideboard"
                    checked={includeSideboard}
                    onCheckedChange={setIncludeSideboard}
                    aria-label="Include sideboard cards in the sample pool"
                  />
                  <Label
                    htmlFor="goldfish-sideboard"
                    className="cursor-pointer"
                  >
                    Sideboard
                  </Label>
                </div>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      {stats && (
        <div className="space-y-4" aria-live="polite">
          {/* Summary metrics */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <SummaryCard
              icon={<HandCoins className="w-4 h-4" aria-hidden="true" />}
              label="Avg opening lands"
              value={stats.avgOpeningLands.toFixed(2)}
              hint={`σ ${stats.openingLandsStdDev.toFixed(2)}`}
            />
            <SummaryCard
              icon={<Percent className="w-4 h-4" aria-hidden="true" />}
              label="Mulligan rate"
              value={`${(stats.mulliganRate * 100).toFixed(0)}%`}
              hint={`avg ${stats.avgMulligans.toFixed(2)}/hand`}
            />
            <SummaryCard
              icon={<Check className="w-4 h-4" aria-hidden="true" />}
              label="Keep at 7"
              value={`${(stats.keepAtSevenRate * 100).toFixed(0)}%`}
            />
            <SummaryCard
              icon={<Sigma className="w-4 h-4" aria-hidden="true" />}
              label="Trials"
              value={String(stats.iterations)}
              hint={`seed ${stats.seed}`}
            />
          </div>

          {/* Opening land histogram */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm flex items-center gap-2">
                <TrendingUp className="w-4 h-4" aria-hidden="true" />
                Opening hand land histogram
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul
                className="space-y-1.5"
                aria-label="Land count distribution (0 to 7)"
              >
                {stats.landHistogram.map((count, lands) => (
                  <li key={lands} className="flex items-center gap-2 text-xs">
                    <span className="w-4 text-right tabular-nums text-muted-foreground">
                      {lands}
                    </span>
                    <Progress
                      value={(count / maxHistogram) * 100}
                      className="h-3 flex-1"
                      aria-label={`${count} hands with ${lands} lands`}
                    />
                    <span className="w-10 text-right tabular-nums">
                      {count}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-2">
            {/* On-curve cast % */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">On-curve castable</CardTitle>
                <CardDescription>
                  % of trials able to cast a CMC-N spell on turn N.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1.5">
                  {Object.entries(stats.onCurveCastPercent).map(
                    ([cmc, pct]) => (
                      <li key={cmc} className="flex items-center gap-2 text-xs">
                        <span className="w-16 text-muted-foreground">
                          {cmc}-drop
                        </span>
                        <Progress
                          value={pct}
                          className="h-3 flex-1"
                          aria-label={`${pct.toFixed(0)} percent on curve for ${cmc}-drops`}
                        />
                        <span className="w-12 text-right tabular-nums">
                          {pct.toFixed(0)}%
                        </span>
                      </li>
                    ),
                  )}
                </ul>
              </CardContent>
            </Card>

            {/* Avg lands by turn */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Average lands by turn</CardTitle>
                <CardDescription>
                  Mean lands in play after each turn&apos;s land drop.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                  {stats.avgLandsByTurn.map((avg, i) => (
                    <li key={i} className="flex justify-between">
                      <span className="text-muted-foreground">
                        Turn {i + 1}
                      </span>
                      <span className="tabular-nums">{avg.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          </div>

          {/* Sample opening hand */}
          <Card>
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <CardTitle className="text-sm">Sample opening hand</CardTitle>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopy}
                  aria-label="Copy simulation summary to clipboard"
                >
                  {copied ? (
                    <>
                      <Check className="w-4 h-4" aria-hidden="true" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="w-4 h-4" aria-hidden="true" />
                      Copy summary
                    </>
                  )}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <ul
                className="flex flex-wrap gap-2"
                aria-label="Sampled opening hand cards"
              >
                {stats.sampleHand.map((card, idx) => (
                  <li
                    key={`${card.id}-${idx}`}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs",
                      card.isLand
                        ? "border-amber-500/40 bg-amber-500/5"
                        : "border-blue-500/40 bg-blue-500/5",
                    )}
                  >
                    <span className="font-medium">{card.name}</span>
                    <Separator
                      orientation="vertical"
                      className="mx-1 inline-block h-3"
                    />
                    <span className="text-muted-foreground">
                      {card.isLand ? "Land" : `${card.cmc} CMC`}
                    </span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}

interface SummaryCardProps {
  icon: React.ReactNode;
  label: string;
  value: string;
  hint?: string;
}

function SummaryCard({ icon, label, value, hint }: SummaryCardProps) {
  return (
    <Card>
      <CardContent className="pt-4">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          {icon}
          {label}
        </div>
        <div className="mt-1 text-2xl font-bold tabular-nums">{value}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </CardContent>
    </Card>
  );
}

/** Parse a seed input string into a finite integer (falls back to Date.now()). */
function parseSeed(raw: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && raw.trim() !== "" ? Math.trunc(n) : Date.now();
}

export default GoldfishSimulator;
