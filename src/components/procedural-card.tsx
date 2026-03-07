'use client';

import { CardArt } from './card-art';

/**
 * ProceduralCard Component
 *
 * A simplified card component that uses procedural artwork by default.
 * This is a convenience wrapper for CardArt with useProcedural=true.
 */

export interface ProceduralCardProps {
  cardName: string;
  cardId: string;
  colors: string[];
  typeLine: string;
  cmc: number;
  size?: 'thumbnail' | 'small' | 'normal' | 'large' | 'full';
  onClick?: () => void;
  className?: string;
}

export function ProceduralCard({
  cardName,
  cardId,
  colors,
  typeLine,
  cmc,
  size = 'normal',
  onClick,
  className,
}: ProceduralCardProps) {
  return (
    <CardArt
      cardName={cardName}
      scryfallCard={{
        id: cardId,
        name: cardName,
        color_identity: colors,
        type_line: typeLine,
        cmc,
        colors,
      }}
      useProcedural={true}
      size={size}
      onClick={onClick}
      className={className}
      lazy={false}
      showSkeleton={false}
    />
  );
}
