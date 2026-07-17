"use client";

import { useState, useEffect, useCallback, useMemo, memo } from "react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  PieChart as PieChartIcon,
  Activity,
  Download,
  Upload,
  Trash2,
  Calendar,
  Flame,
  Droplets,
  Skull,
  Shield,
  MousePointerClick,
  Plus,
  Minus as MinusIcon,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ManaCurveGap, DeckFormat } from "@/lib/deck-analyzer";
import {
  safeParseJson,
  DeckStatisticsArraySchema,
} from "@/lib/storage-schemas";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
} from "recharts";

// Magic color hex codes for charts
const MAGIC_COLOR_HEX: Record<string, string> = {
  W: "#F9F99A",
  U: "#0E68AB",
  B: "#150B00",
  R: "#E12D2D",
  G: "#00733E",
  Colorless: "#9CA3AF",
};

// Card type colors for charts
const TYPE_COLORS: Record<string, string> = {
  Creature: "#8B5CF6",
  Instant: "#3B82F6",
  Sorcery: "#EF4444",
  Enchantment: "#F59E0B",
  Artifact: "#6B7280",
  Planeswalker: "#EC4899",
  Land: "#10B981",
};

// Deck statistics types
export interface DeckRecord {
  id: string;
  deckId: string;
  deckName: string;
  format: string;
  result: "win" | "loss" | "draw";
  opponentName?: string;
  date: number;
  duration?: number; // in seconds
}

export interface DeckStatistics {
  deckId: string;
  deckName: string;
  format: string;
  totalGames: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  averageGameDuration: number;
  records: DeckRecord[];
  lastPlayed?: number;
  colorDistribution: Record<string, number>;
  manaCurve: Record<number, number>; // Also known as "energy curve" in generic terminology
}

// Color types for card analysis
export type CardColor =
  "white" | "blue" | "black" | "red" | "green" | "colorless";

export interface CardAnalysis {
  totalCards: number;
  colorDistribution: Record<string, number>;
  manaCurve: Record<number, number>; // Also known as "energy curve" in generic terminology
  typeDistribution: Record<string, number>;
  averageManaValue: number; // Also known as "average energy value"
}

// Calculate win rate percentage
function calculateWinRate(wins: number, total: number): number {
  if (total === 0) return 0;
  return Math.round((wins / total) * 100);
}

// Deck statistics display component.
//
// Wrapped in `React.memo` (default shallow-equality) — the analytics dashboard
// passes the same `stats` references for unchanged decks (see `DeckAnalytics`
// below), so memoizing avoids a needless card-level re-render whenever the
// dashboard re-renders for unrelated reasons. See issue #1248.
interface DeckStatisticsCardProps {
  stats: DeckStatistics;
  className?: string;
}

export const DeckStatisticsCard = memo(function DeckStatisticsCard({
  stats,
  className,
}: DeckStatisticsCardProps) {
  const winRateTrend = useMemo(() => {
    // Calculate recent 5 games win rate vs overall
    const recentGames = stats.records.slice(-5);
    const recentWins = recentGames.filter((r) => r.result === "win").length;
    const recentWinRate = calculateWinRate(recentWins, recentGames.length);
    return recentWinRate - stats.winRate;
  }, [stats]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>{stats.deckName}</span>
          <Badge variant="outline">{stats.format}</Badge>
        </CardTitle>
        <CardDescription>
          Last played:{" "}
          {stats.lastPlayed
            ? new Date(stats.lastPlayed).toLocaleDateString()
            : "Never"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Win rate display */}
        <div className="flex items-center justify-center">
          <div className="text-center">
            <div
              className={cn(
                "text-4xl font-bold",
                stats.winRate >= 60
                  ? "text-green-500"
                  : stats.winRate >= 40
                    ? "text-yellow-500"
                    : "text-red-500",
              )}
            >
              {stats.winRate}%
            </div>
            <div className="text-sm text-muted-foreground">
              Win Rate ({stats.totalGames} games)
            </div>
            {winRateTrend !== 0 && (
              <div
                className={cn(
                  "flex items-center justify-center gap-1 text-sm mt-1",
                  winRateTrend > 0 ? "text-green-500" : "text-red-500",
                )}
              >
                {winRateTrend > 0 ? (
                  <TrendingUp className="w-3 h-3" />
                ) : (
                  <TrendingDown className="w-3 h-3" />
                )}
                {Math.abs(winRateTrend)}% recent trend
              </div>
            )}
          </div>
        </div>

        {/* W/L/D breakdown */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="p-2 rounded bg-green-500/10">
            <div className="text-xl font-bold text-green-500">{stats.wins}</div>
            <div className="text-xs text-muted-foreground">Wins</div>
          </div>
          <div className="p-2 rounded bg-red-500/10">
            <div className="text-xl font-bold text-red-500">{stats.losses}</div>
            <div className="text-xs text-muted-foreground">Losses</div>
          </div>
          <div className="p-2 rounded bg-yellow-500/10">
            <div className="text-xl font-bold text-yellow-500">
              {stats.draws}
            </div>
            <div className="text-xs text-muted-foreground">Draws</div>
          </div>
        </div>

        {/* Average game duration */}
        {stats.averageGameDuration > 0 && (
          <div className="text-center text-sm text-muted-foreground">
            Average game: {Math.floor(stats.averageGameDuration / 60)}m{" "}
            {Math.round(stats.averageGameDuration % 60)}s
          </div>
        )}
      </CardContent>
    </Card>
  );
});

// ============================================
// RECHARTS-BASED CHART COMPONENTS
// ============================================

// Color distribution pie chart (legacy CSS-based)
interface ColorDistributionChartProps {
  distribution: Record<string, number>;
  className?: string;
}

export function ColorDistributionChart({
  distribution,
  className,
}: ColorDistributionChartProps) {
  const colorConfig: Record<string, { color: string; icon: React.ReactNode }> =
    {
      white: {
        color: "bg-yellow-100 border-yellow-400",
        icon: <Shield className="w-4 h-4 text-yellow-600" />,
      },
      blue: {
        color: "bg-blue-100 border-blue-400",
        icon: <Droplets className="w-4 h-4 text-blue-600" />,
      },
      black: {
        color: "bg-gray-200 border-gray-500",
        icon: <Skull className="w-4 h-4 text-gray-700" />,
      },
      red: {
        color: "bg-red-100 border-red-400",
        icon: <Flame className="w-4 h-4 text-red-600" />,
      },
      green: {
        color: "bg-green-100 border-green-400",
        icon: <Activity className="w-4 h-4 text-green-600" />,
      },
      colorless: {
        color: "bg-slate-100 border-slate-400",
        icon: <Minus className="w-4 h-4 text-slate-600" />,
      },
    };

  const total = Object.values(distribution).reduce((a, b) => a + b, 0);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PieChartIcon className="w-5 h-5" />
          Color Distribution
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {Object.entries(distribution).map(([color, count]) => {
          const config = colorConfig[color] || colorConfig.colorless;
          const percentage = total > 0 ? Math.round((count / total) * 100) : 0;

          return (
            <div key={color} className="flex items-center gap-2">
              <div
                className={cn(
                  "w-8 h-8 rounded flex items-center justify-center",
                  config.color,
                )}
              >
                {config.icon}
              </div>
              <div className="flex-1">
                <div className="flex justify-between text-sm">
                  <span className="capitalize">{color}</span>
                  <span className="text-muted-foreground">
                    {count} ({percentage}%)
                  </span>
                </div>
                <div className="h-2 bg-muted rounded-full overflow-hidden">
                  <div
                    className={cn(
                      "h-full transition-all",
                      config.color.split(" ")[0],
                    )}
                    style={{ width: `${percentage}%` }}
                  />
                </div>
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}

// ============================================
// NEW RECHARTS-BASED CHART COMPONENTS
// ============================================

/**
 * Shape of a single bar in `ManaCurveChart`.
 *
 * Exported so the deck-stats panel can pre-compute the data via `useMemo`
 * keyed on the deck's content signature and pass it through verbatim
 * (see issue #1248). When the panel already has `gaps`/`optimalTargets`
 * resolved against the deck signature, it can fill in `target`/`gap`/`fill`
 * here; otherwise those fields can be left undefined and the chart will
 * fill them in via its internal decoration.
 */
export interface ManaCurveChartDatum {
  cmc: string;
  cmcNum: number;
  count: number;
  /** Optional — only set when `optimalTargets` were provided. */
  target?: number;
  /** Optional — only set when a gap exists for this CMC. */
  gap?: ManaCurveGap;
  /** Optional — chart computes a default when undefined. */
  fill?: string;
}

/**
 * Recharts-based Mana Curve Chart
 * Displays the distribution of cards by converted mana cost.
 *
 * When `gaps` and `optimalTargets` are provided, bars are color-coded by how far
 * they sit from the format-optimal count, and clicking a bar reveals an
 * actionable add/cut suggestion.
 */
interface ManaCurveChartProps {
  manaCurve?: Record<number, number>;
  /** Pre-computed chart data. Takes precedence over `manaCurve`. */
  data?: readonly ManaCurveChartDatum[];
  className?: string;
  /** Format used for the optimal-curve comparison (e.g. 'commander'). */
  format?: DeckFormat;
  /** Per-bucket gaps vs. the optimal curve. */
  gaps?: ManaCurveGap[];
  /** Optional optimal target counts keyed by CMC bucket (1..7). */
  optimalTargets?: Record<number, number>;
}

// Map a gap to a bar fill color.
function gapFill(gap: ManaCurveGap | undefined): string {
  if (!gap) return "hsl(var(--primary))";
  if (gap.difference > 0) return "#f59e0b"; // too few — amber
  return "#ef4444"; // too many — red
}

export const ManaCurveChart = memo(function ManaCurveChart({
  manaCurve,
  data: dataProp,
  className,
  format,
  gaps,
  optimalTargets,
}: ManaCurveChartProps) {
  const [selectedCmc, setSelectedCmc] = useState<number | null>(null);

  // Convert mana curve to array format for Recharts.
  // When `data` is pre-computed by the parent (deck-stats panel pattern from
  // issue #1248), skip the conversion entirely. Otherwise decorate
  // `manaCurve` with `gaps`/`optimalTargets`/`fill` as before.
  const data = useMemo<ManaCurveChartDatum[]>(() => {
    if (dataProp) {
      const base = Array.from(dataProp);
      const interactive = Array.isArray(gaps) || !!optimalTargets;
      if (!interactive) {
        // Fill in default `fill` when caller pre-computed bare data only.
        return base.map((d) => ({
          ...d,
          fill: d.fill ?? "hsl(var(--primary))",
        }));
      }
      const gapByCmc = new Map<number, ManaCurveGap>();
      (gaps || []).forEach((g) => gapByCmc.set(g.cmc, g));
      return base.map((d) => ({
        ...d,
        target: d.target ?? optimalTargets?.[d.cmcNum],
        gap: d.gap ?? gapByCmc.get(d.cmcNum),
        fill: d.fill ?? gapFill(d.gap ?? gapByCmc.get(d.cmcNum)),
      }));
    }
    if (!manaCurve) return [];
    const gapByCmc = new Map<number, ManaCurveGap>();
    (gaps || []).forEach((g) => gapByCmc.set(g.cmc, g));

    return Object.entries(manaCurve)
      .filter(([cmc]) => parseInt(cmc) > 0) // exclude the land (0) bucket
      .map(([cmc, count]) => {
        const cmcNum = parseInt(cmc);
        const gap = gapByCmc.get(cmcNum);
        const target = optimalTargets?.[cmcNum];
        return {
          cmc: cmcNum >= 7 ? "7+" : cmc,
          cmcNum,
          count,
          target,
          gap,
          fill: gap ? gapFill(gap) : "hsl(var(--primary))",
        };
      });
  }, [dataProp, manaCurve, gaps, optimalTargets]);

  const interactive = Array.isArray(gaps) || !!optimalTargets;
  const selectedGap = useMemo(() => {
    if (selectedCmc == null) return null;
    return (gaps || []).find((g) => g.cmc === selectedCmc) ?? null;
  }, [gaps, selectedCmc]);

  // Look up the raw count/target for the selected bucket even when not a gap.
  const selectedDetail = useMemo(() => {
    if (selectedCmc == null) return null;
    const point = data.find((d) => d.cmcNum === selectedCmc);
    if (!point) return null;
    return { count: point.count, target: point.target };
  }, [data, selectedCmc]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="w-5 h-5" />
          Mana Curve
          {format && (
            <Badge variant="outline" className="ml-1 capitalize text-xs">
              {format}
            </Badge>
          )}
          {interactive && (
            <MousePointerClick className="w-3.5 h-3.5 text-muted-foreground ml-auto" />
          )}
        </CardTitle>
        {interactive && (
          <CardDescription className="text-xs">
            Click a bar for add/cut suggestions. Amber = too few, red = too
            many.
          </CardDescription>
        )}
      </CardHeader>
      <CardContent className="space-y-3">
        <div aria-hidden="true">
          <ResponsiveContainer width="100%" height={200}>
            <BarChart
              data={data}
              margin={{ top: 10, right: 10, left: -10, bottom: 0 }}
            >
              <XAxis
                dataKey="cmc"
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
              />
              <YAxis
                tick={{ fontSize: 12 }}
                tickLine={false}
                axisLine={{ stroke: "hsl(var(--border))" }}
                width={30}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value, _name, item) => {
                  // recharts v3: value is `ValueType | undefined`; the data
                  // point with our custom fields now lives on `item.payload`.
                  const numericValue =
                    typeof value === "number" ? value : Number(value);
                  const target = (
                    item?.payload as { target?: number } | undefined
                  )?.target;
                  const lines = [`${numericValue} cards`];
                  if (typeof target === "number")
                    lines.push(`Target: ~${target}`);
                  return [lines.join(" • "), "Count"];
                }}
              />
              <Bar
                dataKey="count"
                radius={[4, 4, 0, 0]}
                cursor={interactive ? "pointer" : undefined}
                onClick={
                  interactive
                    ? (data) => {
                        // recharts v3: BarMouseEvent passes `BarRectangleItem`,
                        // not the raw chart datum; the original datum is
                        // available on `data.payload`.
                        const cmcNum = (
                          data?.payload as { cmcNum?: number } | undefined
                        )?.cmcNum;
                        if (typeof cmcNum === "number") {
                          setSelectedCmc(cmcNum);
                        }
                      }
                    : undefined
                }
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.fill}
                    opacity={
                      selectedCmc == null || selectedCmc === entry.cmcNum
                        ? 1
                        : 0.4
                    }
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>
            Mana curve: number of cards at each converted mana cost
          </caption>
          <thead>
            <tr>
              <th scope="col">Converted Mana Cost</th>
              <th scope="col">Number of Cards</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={String(d.cmc)}>
                <th scope="row">{d.cmc}</th>
                <td>{d.count}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Selected bucket suggestion */}
        {interactive && selectedCmc != null && selectedDetail && (
          <div className="rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-medium capitalize">
                {selectedCmc >= 7 ? "7+ CMC" : `${selectedCmc}-drop`} spells
              </span>
              <Badge variant="outline">
                {selectedDetail.count} / target ~{selectedDetail.target ?? "—"}
              </Badge>
            </div>
            {selectedGap ? (
              <div
                className={cn(
                  "mt-2 flex items-start gap-2",
                  selectedGap.difference > 0
                    ? "text-amber-600 dark:text-amber-400"
                    : "text-red-600 dark:text-red-400",
                )}
              >
                {selectedGap.difference > 0 ? (
                  <Plus className="w-4 h-4 mt-0.5 shrink-0" />
                ) : (
                  <MinusIcon className="w-4 h-4 mt-0.5 shrink-0" />
                )}
                <span>
                  {selectedGap.difference > 0 ? "Add" : "Cut"}{" "}
                  {Math.abs(selectedGap.difference) <= 1
                    ? Math.abs(selectedGap.difference)
                    : `${Math.max(1, Math.abs(selectedGap.difference) - 1)}-${Math.abs(selectedGap.difference)}`}{" "}
                  {selectedGap.difference > 0 ? "more" : "fewer"} to reach the
                  optimal {format} curve.
                </span>
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-2 text-green-600 dark:text-green-400">
                <Check className="w-4 h-4" />
                <span>On target for the optimal {format} curve.</span>
              </div>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 px-2 text-xs"
              onClick={() => setSelectedCmc(null)}
            >
              Clear
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
});

/**
 * Shape of a single bar in `CardTypeChart`.
 *
 * Exported so the deck-stats panel can pre-compute the data via `useMemo`
 * keyed on a coarse dependency (the deck's content signature) and pass it
 * through verbatim — the chart's `React.memo` then shallow-compares `data`
 * by reference and skips the re-render when nothing changed.
 */
export interface CardTypeChartDatum {
  type: string;
  count: number;
  percentage: number;
  fill: string;
}

/**
 * Recharts-based Card Type Chart
 * Displays the distribution of cards by type (creature, instant, sorcery, etc.)
 */
interface CardTypeChartProps {
  typeDistribution?: Record<string, number>;
  /** Pre-computed chart data. Takes precedence over `typeDistribution`. */
  data?: readonly CardTypeChartDatum[];
  chartType?: "pie" | "bar";
  className?: string;
}

export const CardTypeChart = memo(function CardTypeChart({
  typeDistribution,
  data: dataProp,
  chartType = "pie",
  className,
}: CardTypeChartProps) {
  // Convert type distribution to array format for Recharts.
  // When `data` is pre-computed by the parent (deck-stats panel pattern from
  // issue #1248), skip the conversion entirely so the chart's `React.memo`
  // can shallow-compare on a reference that only changes when the deck's
  // contents actually change.
  const data = useMemo<CardTypeChartDatum[]>(() => {
    if (dataProp) return Array.from(dataProp);
    if (!typeDistribution) return [];
    const total = Object.values(typeDistribution).reduce((a, b) => a + b, 0);
    return Object.entries(typeDistribution)
      .filter(([, count]) => count > 0)
      .map(([type, count]) => ({
        type: type.charAt(0).toUpperCase() + type.slice(1),
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
        fill: TYPE_COLORS[type] || "#6B7280",
      }));
  }, [dataProp, typeDistribution]);

  if (data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Type Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No cards in deck
          </p>
        </CardContent>
      </Card>
    );
  }

  // Screen-reader text alternative mirroring the chart data (WCAG 1.1.1)
  const typeDataTable = (
    <table className="sr-only">
      <caption>
        Card type breakdown: number and percentage of cards by type
      </caption>
      <thead>
        <tr>
          <th scope="col">Card Type</th>
          <th scope="col">Number of Cards</th>
          <th scope="col">Percentage of Deck</th>
        </tr>
      </thead>
      <tbody>
        {data.map((d) => (
          <tr key={d.type}>
            <th scope="row">{d.type}</th>
            <td>{d.count}</td>
            <td>{d.percentage}%</td>
          </tr>
        ))}
      </tbody>
    </table>
  );

  if (chartType === "bar") {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Type Breakdown
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div aria-hidden="true">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart
                data={data}
                layout="vertical"
                margin={{ top: 10, right: 30, left: 60, bottom: 0 }}
              >
                <XAxis
                  type="number"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                />
                <YAxis
                  type="category"
                  dataKey="type"
                  tick={{ fontSize: 12 }}
                  tickLine={false}
                  axisLine={{ stroke: "hsl(var(--border))" }}
                  width={60}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  formatter={(value, name) => [
                    // recharts v3: value is `ValueType | undefined`.
                    `${typeof value === "number" ? value : Number(value ?? 0)} cards`,
                    name === "count" ? "Count" : name,
                  ]}
                />
                <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                  {data.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.fill} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          {typeDataTable}
        </CardContent>
      </Card>
    );
  }

  // Pie chart
  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Type Breakdown
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div aria-hidden="true">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                outerRadius={80}
                dataKey="count"
                nameKey="type"
                // recharts v3: label is `PieLabelRenderProps`; the original
                // datum (with our custom `type`/`percentage` fields) is on
                // `payload`.
                label={({ payload }) => {
                  const datum = payload as
                    { type?: string; percentage?: number } | undefined;
                  return `${datum?.type ?? ""}: ${datum?.percentage ?? 0}%`;
                }}
                labelLine={false}
              >
                {data.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.fill} />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value) => [
                  // recharts v3: value is `ValueType | undefined`.
                  `${typeof value === "number" ? value : Number(value ?? 0)} cards`,
                  "Count",
                ]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        {typeDataTable}
      </CardContent>
    </Card>
  );
});

/**
 * Shape of a single slice in `DeckColorChart`.
 *
 * Exported so the deck-stats panel can pre-compute the data via `useMemo`
 * keyed on the deck's content signature and pass it through verbatim
 * (see issue #1248).
 */
export interface DeckColorChartDatum {
  color: string;
  count: number;
  percentage: number;
  fill: string;
}

/**
 * Recharts-based Deck Color Chart
 * Displays the color distribution of the deck
 */
interface DeckColorChartProps {
  colorDistribution?: Record<string, number>;
  /** Pre-computed chart data. Takes precedence over `colorDistribution`. */
  data?: readonly DeckColorChartDatum[];
  className?: string;
}

export const DeckColorChart = memo(function DeckColorChart({
  colorDistribution,
  data: dataProp,
  className,
}: DeckColorChartProps) {
  // Convert color distribution to array format for Recharts.
  // When `data` is pre-computed by the parent (deck-stats panel pattern from
  // issue #1248), skip the conversion entirely so the chart's `React.memo`
  // can shallow-compare on a reference that only changes when the deck's
  // contents actually change.
  const data = useMemo<DeckColorChartDatum[]>(() => {
    if (dataProp) return Array.from(dataProp);
    if (!colorDistribution) return [];
    const total = Object.values(colorDistribution).reduce((a, b) => a + b, 0);
    return Object.entries(colorDistribution)
      .filter(([, count]) => count > 0)
      .map(([color, count]) => ({
        color,
        count,
        percentage: total > 0 ? Math.round((count / total) * 100) : 0,
        fill: MAGIC_COLOR_HEX[color] || MAGIC_COLOR_HEX.Colorless,
      }));
  }, [dataProp, colorDistribution]);

  // Color name mapping for display
  const colorNames: Record<string, string> = {
    W: "White",
    U: "Blue",
    B: "Black",
    R: "Red",
    G: "Green",
    Colorless: "Colorless",
  };

  if (data.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Color Distribution
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground text-center py-4">
            No cards in deck
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          Color Distribution
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div aria-hidden="true">
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie
                data={data}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={90}
                dataKey="count"
                nameKey="color"
                // recharts v3: label is `PieLabelRenderProps`; the original
                // datum (with our custom `color`/`percentage` fields) is on
                // `payload`.
                label={({ payload }) => {
                  const datum = payload as
                    { color?: string; percentage?: number } | undefined;
                  const color = datum?.color ?? "";
                  return `${colorNames[color] || color}: ${datum?.percentage ?? 0}%`;
                }}
                labelLine={false}
              >
                {data.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={entry.fill}
                    stroke="hsl(var(--card))"
                    strokeWidth={2}
                  />
                ))}
              </Pie>
              <Tooltip
                contentStyle={{
                  backgroundColor: "hsl(var(--card))",
                  border: "1px solid hsl(var(--border))",
                  borderRadius: "8px",
                }}
                formatter={(value) => [
                  // recharts v3: value is `ValueType | undefined`.
                  `${typeof value === "number" ? value : Number(value ?? 0)} cards`,
                  "Count",
                ]}
              />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <table className="sr-only">
          <caption>
            Color distribution: number and percentage of cards by color
          </caption>
          <thead>
            <tr>
              <th scope="col">Color</th>
              <th scope="col">Number of Cards</th>
              <th scope="col">Percentage of Deck</th>
            </tr>
          </thead>
          <tbody>
            {data.map((d) => (
              <tr key={d.color}>
                <th scope="row">{colorNames[d.color] || d.color}</th>
                <td>{d.count}</td>
                <td>{d.percentage}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </CardContent>
    </Card>
  );
});

// Match history table
interface MatchHistoryTableProps {
  records: DeckRecord[];
  className?: string;
}

export function MatchHistoryTable({
  records,
  className,
}: MatchHistoryTableProps) {
  const sortedRecords = [...records].sort((a, b) => b.date - a.date);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="w-5 h-5" />
          Match History
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sortedRecords.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            No matches recorded yet.
          </p>
        ) : (
          <div className="space-y-2 max-h-64 overflow-y-auto">
            {sortedRecords.map((record) => (
              <div
                key={record.id}
                className="flex items-center justify-between p-2 rounded bg-muted"
              >
                <div className="flex items-center gap-2">
                  <Badge
                    className={cn(
                      record.result === "win"
                        ? "bg-green-500"
                        : record.result === "loss"
                          ? "bg-red-500"
                          : "bg-yellow-500",
                    )}
                  >
                    {record.result.toUpperCase()}
                  </Badge>
                  <span className="text-sm">
                    {record.opponentName || "Unknown opponent"}
                  </span>
                </div>
                <div className="text-xs text-muted-foreground">
                  {new Date(record.date).toLocaleDateString()}
                  {record.duration && ` • ${Math.floor(record.duration / 60)}m`}
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// Analytics dashboard
interface DeckAnalyticsProps {
  statistics: DeckStatistics[];
  className?: string;
}

export function DeckAnalytics({ statistics, className }: DeckAnalyticsProps) {
  // Calculate overall stats
  const overallStats = useMemo(() => {
    const totalGames = statistics.reduce((sum, s) => sum + s.totalGames, 0);
    const totalWins = statistics.reduce((sum, s) => sum + s.wins, 0);
    const totalLosses = statistics.reduce((sum, s) => sum + s.losses, 0);
    const totalDraws = statistics.reduce((sum, s) => sum + s.draws, 0);

    return {
      totalGames,
      totalWins,
      totalLosses,
      totalDraws,
      overallWinRate: calculateWinRate(totalWins, totalGames),
    };
  }, [statistics]);

  // Get best/worst decks
  const { bestDeck, worstDeck } = useMemo(() => {
    if (statistics.length === 0) return { bestDeck: null, worstDeck: null };

    const sorted = [...statistics].sort((a, b) => b.winRate - a.winRate);
    return {
      bestDeck: sorted[0],
      worstDeck: sorted[sorted.length - 1],
    };
  }, [statistics]);

  return (
    <div className={cn("space-y-6", className)}>
      {/* Overview stats */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold">
                {overallStats.totalGames}
              </div>
              <div className="text-sm text-muted-foreground">Total Games</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-green-500">
                {overallStats.totalWins}
              </div>
              <div className="text-sm text-muted-foreground">Wins</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div className="text-3xl font-bold text-red-500">
                {overallStats.totalLosses}
              </div>
              <div className="text-sm text-muted-foreground">Losses</div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="text-center">
              <div
                className={cn(
                  "text-3xl font-bold",
                  overallStats.overallWinRate >= 60
                    ? "text-green-500"
                    : overallStats.overallWinRate >= 40
                      ? "text-yellow-500"
                      : "text-red-500",
                )}
              >
                {overallStats.overallWinRate}%
              </div>
              <div className="text-sm text-muted-foreground">Win Rate</div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Best/Worst decks */}
      {bestDeck && worstDeck && bestDeck.deckId !== worstDeck.deckId && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="border-green-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-green-500">
                <TrendingUp className="w-5 h-5" />
                Best Deck
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeckStatisticsCard stats={bestDeck} />
            </CardContent>
          </Card>
          <Card className="border-red-500/30">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-red-500">
                <TrendingDown className="w-5 h-5" />
                Needs Work
              </CardTitle>
            </CardHeader>
            <CardContent>
              <DeckStatisticsCard stats={worstDeck} />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Individual deck stats */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {statistics.map((stats) => (
          <DeckStatisticsCard key={stats.deckId} stats={stats} />
        ))}
      </div>
    </div>
  );
}

// Hook for managing deck statistics.
//
// Note: this hook used to be exported as `useDeckStatistics`, which collided
// with the pure-memoization hook of the same name in `src/hooks/use-deck-
// statistics.ts`. Issue #1248 renamed it to `usePersistedDeckStatistics` so
// the local memoization helper (used by the deck-builder stats panel) and the
// IndexedDB-backed analytics dashboard hook no longer share a single symbol.
//
// The legacy `useDeckStatistics` export is preserved as a thin alias for
// existing analytics-dashboard callers; new consumers should import the
// renamed `usePersistedDeckStatistics` directly.
interface UsePersistedDeckStatisticsOptions {
  storageKey?: string;
}

interface UsePersistedDeckStatisticsReturn {
  statistics: DeckStatistics[];
  recordGame: (
    deckId: string,
    deckName: string,
    format: string,
    result: "win" | "loss" | "draw",
    opponentName?: string,
    duration?: number,
  ) => void;
  getDeckStats: (deckId: string) => DeckStatistics | undefined;
  clearDeckStats: (deckId: string) => void;
  clearAllStats: () => void;
  exportStats: () => string;
  importStats: (json: string) => boolean;
}

export function usePersistedDeckStatistics({
  storageKey = "deck-statistics",
}: UsePersistedDeckStatisticsOptions = {}): UsePersistedDeckStatisticsReturn {
  const [statistics, setStatistics] = useState<DeckStatistics[]>([]);

  // Load from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      // Validate before it reaches state. Poisoned / cross-version JSON must
      // fall back to the empty default instead of crashing the tree on first
      // render. The key is cleared on failure so the next mount starts clean.
      const result = safeParseJson(stored, DeckStatisticsArraySchema, {
        label: "deck-statistics",
        removeOnFailure: storageKey,
      });
      if (result.success) {
        setStatistics(result.value);
      }
    }
  }, [storageKey]);

  const recordGame = useCallback(
    (
      deckId: string,
      deckName: string,
      format: string,
      result: "win" | "loss" | "draw",
      opponentName?: string,
      duration?: number,
    ) => {
      const newRecord: DeckRecord = {
        id: `record-${Date.now()}`,
        deckId,
        deckName,
        format,
        result,
        opponentName,
        date: Date.now(),
        duration,
      };

      setStatistics((prev) => {
        // Find or create deck stats
        let deckStats = prev.find((s) => s.deckId === deckId);

        if (!deckStats) {
          deckStats = {
            deckId,
            deckName,
            format,
            totalGames: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            winRate: 0,
            averageGameDuration: 0,
            records: [],
            colorDistribution: {},
            manaCurve: {}, // Also known as "energy curve" in generic terminology
          };
        }

        // Update stats
        const newWins = result === "win" ? deckStats.wins + 1 : deckStats.wins;
        const newLosses =
          result === "loss" ? deckStats.losses + 1 : deckStats.losses;
        const newDraws =
          result === "draw" ? deckStats.draws + 1 : deckStats.draws;
        const newTotal = deckStats.totalGames + 1;

        // Calculate new average duration
        let newAvgDuration = deckStats.averageGameDuration;
        if (duration) {
          const totalDuration =
            deckStats.averageGameDuration * deckStats.totalGames + duration;
          newAvgDuration = totalDuration / newTotal;
        }

        const updatedDeckStats: DeckStatistics = {
          ...deckStats,
          totalGames: newTotal,
          wins: newWins,
          losses: newLosses,
          draws: newDraws,
          winRate: calculateWinRate(newWins, newTotal),
          averageGameDuration: newAvgDuration,
          records: [...deckStats.records, newRecord],
          lastPlayed: Date.now(),
        };

        // Replace or add deck stats
        const existingIndex = prev.findIndex((s) => s.deckId === deckId);
        if (existingIndex >= 0) {
          const newStats = [...prev];
          newStats[existingIndex] = updatedDeckStats;
          return newStats;
        } else {
          return [...prev, updatedDeckStats];
        }
      });
    },
    [],
  );

  const getDeckStats = useCallback(
    (deckId: string) => {
      return statistics.find((s) => s.deckId === deckId);
    },
    [statistics],
  );

  const clearDeckStats = useCallback((deckId: string) => {
    setStatistics((prev) => prev.filter((s) => s.deckId !== deckId));
  }, []);

  const clearAllStats = useCallback(() => {
    setStatistics([]);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  const exportStats = useCallback(() => {
    return JSON.stringify(statistics, null, 2);
  }, [statistics]);

  const importStats = useCallback(
    (json: string): boolean => {
      // Validate EVERY element against the schema BEFORE touching state or
      // localStorage. Previously any array of any shape was accepted and
      // written back, permanently clobbering the user's real stats on a bad
      // import (silent data loss). A malformed or wrong-shape payload now
      // returns false and leaves the existing stored value untouched.
      const result = safeParseJson(json, DeckStatisticsArraySchema, {
        label: "imported deck-statistics",
      });
      if (result.success) {
        setStatistics(result.value);
        localStorage.setItem(storageKey, JSON.stringify(result.value));
        return true;
      }
      return false;
    },
    [storageKey],
  );

  return {
    statistics,
    recordGame,
    getDeckStats,
    clearDeckStats,
    clearAllStats,
    exportStats,
    importStats,
  };
}

/**
 * @deprecated Use {@link usePersistedDeckStatistics} instead.
 *
 * Legacy alias preserved for the analytics dashboard. Kept as a thin
 * re-export so any existing import path keeps working while we migrate
 * callers. New code should reach for `usePersistedDeckStatistics` directly
 * to avoid colliding with the deck-builder memoization hook of the same
 * name in `src/hooks/use-deck-statistics.ts`.
 */
export const useDeckStatistics = usePersistedDeckStatistics;

// Import/Export controls component
interface ImportExportControlsProps {
  onImport: (json: string) => void;
  onExport: () => void;
  onClear: () => void;
  className?: string;
}

export function ImportExportControls({
  onImport,
  onExport,
  onClear,
  className,
}: ImportExportControlsProps) {
  const [importText, setImportText] = useState("");

  const handleImport = () => {
    if (importText.trim()) {
      onImport(importText);
      setImportText("");
    }
  };

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Download className="w-5 h-5" />
          Import / Export
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2">
          <Button onClick={onExport} className="w-full">
            <Upload className="w-4 h-4 mr-2" />
            Export Statistics
          </Button>
        </div>

        <div className="space-y-2">
          <textarea
            value={importText}
            onChange={(e) => setImportText(e.target.value)}
            placeholder="Paste exported JSON here..."
            className="w-full h-24 px-3 py-2 border rounded-md text-xs resize-none"
          />
          <Button
            onClick={handleImport}
            variant="outline"
            disabled={!importText.trim()}
            className="w-full"
          >
            <Download className="w-4 h-4 mr-2" />
            Import Statistics
          </Button>
        </div>

        <div className="border-t pt-4">
          <Button onClick={onClear} variant="destructive" className="w-full">
            <Trash2 className="w-4 h-4 mr-2" />
            Clear All Statistics
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
