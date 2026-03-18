/**
 * Face-Down Card and Draft Card Components
 *
 * DRFT-03: Cards face-down until user opens pack
 * DRFT-04: Click to pick card from opened pack
 * DRFT-08: Hover tracking for auto-pick functionality
 */

import { cn } from "@/lib/utils";
import type { DraftCard } from "@/lib/limited/types";

// ============================================================================
// FaceDownCard Component
// ============================================================================

export interface FaceDownCardProps {
  /** Called when user clicks to open pack */
  onClick: () => void;
  /** Whether the card is disabled (pack already opened) */
  isDisabled?: boolean;
  /** Optional className for styling */
  className?: string;
}

/**
 * Renders a face-down card (card back)
 *
 * DRFT-03: Shows card back image with dashed border to indicate face-down
 */
export function FaceDownCard({
  onClick,
  isDisabled = false,
  className,
}: FaceDownCardProps) {
  return (
    <button
      onClick={onClick}
      disabled={isDisabled}
      className={cn(
        "relative aspect-[2.5/3.5] rounded-md overflow-hidden",
        "border-2 border-dashed border-muted-foreground/30",
        "bg-gradient-to-br from-muted to-muted/80",
        "transition-all duration-200",
        "hover:border-primary hover:border-solid hover:shadow-md",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-dashed",
        className
      )}
      type="button"
      aria-label="Face-down card - click to reveal"
    >
      {/* Card Back Image */}
      <img
        src="https://cards.scryfall.io/back/0/0.jpg"
        alt="Card back"
        className="w-full h-full object-cover opacity-80"
        loading="lazy"
      />

      {/* Dashed Border Overlay */}
      <div className="absolute inset-0 border-2 border-dashed border-muted-foreground/20 rounded-md" />

      {/* Hover Hint */}
      <div className="absolute inset-0 bg-primary/0 hover:bg-primary/10 transition-colors flex items-center justify-center">
        <span className="text-xs text-muted-foreground opacity-0 hover:opacity-100 transition-opacity font-medium">
          Click to open
        </span>
      </div>
    </button>
  );
}

// ============================================================================
// DraftCard Component
// ============================================================================

export interface DraftCardProps {
  /** Card to display */
  card: DraftCard;
  /** Called when user picks this card */
  onClick: () => void;
  /** Called when user hovers over this card */
  onHover: () => void;
  /** Called when user stops hovering */
  onHoverEnd?: () => void;
  /** Whether this card has already been picked */
  isPicked: boolean;
  /** Optional className for styling */
  className?: string;
}

/**
 * Renders a face-up card in draft for picking
 *
 * DRFT-04: Click to pick card, shows "Pick" overlay on hover
 * DRFT-08: Tracks hover state for auto-pick functionality
 */
export function DraftCard({
  card,
  onClick,
  onHover,
  onHoverEnd,
  isPicked,
  className,
}: DraftCardProps) {
  // Get card image URL
  const imageUrl =
    card.image_uris?.normal ||
    card.image_uris?.large ||
    card.image_uris?.small;

  return (
    <button
      onClick={onClick}
      disabled={isPicked}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      className={cn(
        "relative aspect-[2.5/3.5] rounded-md overflow-hidden",
        "border border-border bg-muted",
        "transition-all duration-200",
        "hover:shadow-lg hover:scale-105 hover:z-10",
        "focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
        "disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100",
        className
      )}
      type="button"
      aria-label={`Pick ${card.name}`}
    >
      {/* Card Image */}
      {imageUrl ? (
        <img
          src={imageUrl}
          alt={card.name}
          className="w-full h-full object-cover"
          loading="lazy"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center p-2 bg-gradient-to-br from-card to-muted">
          <span className="text-xs text-center font-medium leading-tight">
            {card.name}
          </span>
        </div>
      )}

      {/* Picked Overlay */}
      {isPicked && (
        <div className="absolute inset-0 bg-muted/80 flex items-center justify-center">
          <span className="text-sm font-bold text-muted-foreground">Picked</span>
        </div>
      )}

      {/* Pick Overlay on Hover */}
      {!isPicked && (
        <div className="absolute inset-0 bg-primary/70 opacity-0 hover:opacity-100 transition-opacity flex items-center justify-center">
          <span className="text-lg font-bold text-primary-foreground drop-shadow-md">
            Pick
          </span>
        </div>
      )}

      {/* Card Name on Hover */}
      <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
        <p className="text-[10px] text-white line-clamp-2 leading-tight">
          {card.name}
        </p>
        <p className="text-[9px] text-white/70">{card.type_line}</p>
      </div>
    </button>
  );
}

// ============================================================================
// Exports
// ============================================================================
