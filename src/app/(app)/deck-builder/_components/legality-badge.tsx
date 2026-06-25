/**
 * @fileOverview Legality badge used by the deck builder to flag cards that
 * are legal, restricted, banned, or not legal in the active format.
 */

"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { CardLegalityStatus } from "@/hooks/use-format-legality-check";

const STATUS_LABELS: Record<CardLegalityStatus, string> = {
  legal: "Legal",
  restricted: "Restricted",
  banned: "Banned",
  not_legal: "Not Legal",
};

const STATUS_STYLES: Record<CardLegalityStatus, string> = {
  legal: "border-transparent bg-green-600 text-white hover:bg-green-600",
  restricted:
    "border-transparent bg-yellow-500 text-black hover:bg-yellow-500",
  banned: "border-transparent bg-red-600 text-white hover:bg-red-600",
  not_legal:
    "border-transparent bg-yellow-500/80 text-black hover:bg-yellow-500/80",
};

export interface LegalityBadgeProps {
  status: CardLegalityStatus;
  /** Optional override for the visible label. */
  label?: string;
  className?: string;
}

/**
 * Render a colour-coded badge describing a card's legality in the active
 * format. Green = legal, yellow = restricted/not-legal warning, red = banned.
 */
export function LegalityBadge({ status, label, className }: LegalityBadgeProps) {
  return (
    <Badge
      variant="outline"
      className={cn(STATUS_STYLES[status], className)}
      data-testid={`legality-badge-${status}`}
    >
      {label ?? STATUS_LABELS[status]}
    </Badge>
  );
}
