"use client";

import { Fragment } from "react";
import type { Phase } from "@/lib/game-state";

interface PhaseTrackerProps {
  currentPhase: Phase;
  isPlayerTurn: boolean;
}

export function PhaseTracker({
  currentPhase,
  isPlayerTurn: _isPlayerTurn,
}: PhaseTrackerProps) {
  const phases: { key: Phase; label: string }[] = [
    { key: "untap" as Phase, label: "Untap" },
    { key: "upkeep" as Phase, label: "Upkeep" },
    { key: "draw" as Phase, label: "Draw" },
    { key: "precombat_main" as Phase, label: "Main 1" },
    { key: "begin_combat" as Phase, label: "Combat" },
    { key: "declare_attackers" as Phase, label: "Attack" },
    { key: "declare_blockers" as Phase, label: "Block" },
    { key: "combat_damage_first_strike" as Phase, label: "First Strike" },
    { key: "combat_damage" as Phase, label: "Damage" },
    { key: "end_combat" as Phase, label: "End Combat" },
    { key: "postcombat_main" as Phase, label: "Main 2" },
    { key: "end" as Phase, label: "End" },
    { key: "cleanup" as Phase, label: "Cleanup" },
  ];

  const currentIndex = phases.findIndex((p) => p.key === currentPhase);

  return (
    <div className="flex items-center justify-center gap-1.5 px-4 py-1 bg-background/80 border-b overflow-x-auto no-scrollbar">
      {phases.map((phase, idx) => {
        const isCurrent = idx === currentIndex;
        const isPast = idx < currentIndex;
        return (
          <Fragment key={phase.key}>
            <div
              className={`
                flex items-center justify-center transition-all duration-200
                ${isCurrent ? "px-2 py-0.5 rounded bg-primary text-primary-foreground text-[10px] font-bold ring-1 ring-primary ring-offset-1 ring-offset-background" : "w-1.5 h-1.5 rounded-full"}
                ${isPast ? "bg-primary/40" : "bg-muted-foreground/30"}
              `}
              title={phase.label}
            >
              {isCurrent && phase.label}
            </div>
            {idx < phases.length - 1 &&
              idx !== currentIndex &&
              idx !== currentIndex - 1 && (
                <div
                  className={`h-[1px] w-1 ${isPast ? "bg-primary/20" : "bg-muted/20"}`}
                />
              )}
          </Fragment>
        );
      })}
    </div>
  );
}
