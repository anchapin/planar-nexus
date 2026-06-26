"use client";

import React, { useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowDownToLine, ArrowUpFromLine } from "lucide-react";
import type { DeckCard } from "@/app/actions";
import {
  generatePerMatchupSideboardPlans,
  type MatchupSideboardPlan,
} from "@/ai/flows/sideboard-plan";

interface MatchupSideboardPlansProps {
  /** Player's maindeck cards. */
  mainDeck: DeckCard[];
  /** Player's sideboard cards. */
  sideboard: DeckCard[];
  /** Optional opponent archetype names; defaults to one per category. */
  opponentArchetypes?: string[];
  className?: string;
}

/**
 * Coach-generated, per-matchup sideboard plans (issue #1076).
 *
 * Renders a boarding guide for each likely opponent archetype: cards to board
 * IN, cards to board OUT, and a one-line rationale. The plan is computed
 * locally (no LLM) via `generatePerMatchupSideboardPlans`.
 */
export function MatchupSideboardPlans({
  mainDeck,
  sideboard,
  opponentArchetypes,
  className,
}: MatchupSideboardPlansProps) {
  const opponentsKey = JSON.stringify(opponentArchetypes ?? null);
  const result = useMemo(
    () => generatePerMatchupSideboardPlans(mainDeck, sideboard, opponentArchetypes),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [mainDeck, sideboard, opponentsKey],
  );

  if (result.matchupPlans.length === 0) {
    return (
      <Card className={className} aria-label="Matchup sideboard plans">
        <CardContent className="py-6 text-sm text-muted-foreground">
          No opponent archetypes available to plan against.
        </CardContent>
      </Card>
    );
  }

  return (
    <section
      className={className}
      aria-label="Coach matchup sideboard plans"
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h3 className="text-base font-semibold">Matchup Sideboard Plans</h3>
        <Badge variant="secondary">{result.playerArchetype}</Badge>
        <Badge variant="outline">{result.playerArchetypeCategory}</Badge>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {result.matchupPlans.map((plan) => (
          <MatchupPlanCard key={plan.opponentArchetypeName} plan={plan} />
        ))}
      </div>
    </section>
  );
}

function MatchupPlanCard({ plan }: { plan: MatchupSideboardPlan }) {
  const totalIn = plan.boardIn.reduce((s, c) => s + c.count, 0);
  const totalOut = plan.boardOut.reduce((s, c) => s + c.count, 0);

  return (
    <Card
      aria-label={`Sideboard plan versus ${plan.opponentArchetypeName}`}
    >
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">
            vs. {plan.opponentArchetypeName}
          </CardTitle>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1 text-sm font-medium text-green-600">
              <ArrowDownToLine className="h-4 w-4" aria-hidden />
              +{totalIn}
            </span>
            <span className="flex items-center gap-1 text-sm font-medium text-red-600">
              <ArrowUpFromLine className="h-4 w-4" aria-hidden />
              -{totalOut}
            </span>
          </div>
        </div>
        <Badge variant="outline" className="w-fit">
          {plan.opponentArchetypeCategory}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-xs text-muted-foreground">{plan.guidance}</p>

        <CardList
          title="Board In"
          tone="green"
          cards={plan.boardIn}
          emptyText="No sideboard cards recommended for this matchup."
        />
        <CardList
          title="Board Out"
          tone="red"
          cards={plan.boardOut}
          emptyText="Nothing to take out."
        />
      </CardContent>
    </Card>
  );
}

interface CardListProps {
  title: string;
  tone: "green" | "red";
  cards: { cardName: string; count: number; reason: string }[];
  emptyText: string;
}

function CardList({ title, tone, cards, emptyText }: CardListProps) {
  const badgeClass =
    tone === "green" ? "bg-green-50 text-green-700" : "bg-red-50 text-red-700";

  return (
    <div>
      <span className="text-xs font-medium text-muted-foreground">{title}</span>
      {cards.length === 0 ? (
        <p className="mt-1 text-xs italic text-muted-foreground">{emptyText}</p>
      ) : (
        <ul className="mt-1 space-y-1">
          {cards.map((c, i) => (
            <li key={`${c.cardName}-${i}`} className="flex items-start gap-2">
              <Badge variant="outline" className={`shrink-0 text-xs ${badgeClass}`}>
                {c.cardName} ×{c.count}
              </Badge>
              <span className="text-xs text-muted-foreground">{c.reason}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default MatchupSideboardPlans;
