'use client';

import { memo, useMemo } from 'react';
import { cn } from '@/lib/utils';
import {
  type CustomCardDefinition,
  type CardColor,
  CARD_COLORS,
  FRAME_STYLE_COLORS,
  RARITY_COLORS,
} from '@/lib/custom-card';

/**
 * Custom Card Preview Component
 * 
 * Renders a custom Magic: The Gathering card with WYSIWYG styling
 * Used in the Custom Card Creation Studio (Issue #593)
 */

export interface CustomCardPreviewProps {
  /** The custom card definition to render */
  card: CustomCardDefinition;
  /** Additional CSS classes */
  className?: string;
  /** Size multiplier (default 1 = standard card size) */
  scale?: number;
  /** Enable interactive hover effects */
  interactive?: boolean;
  /** Show card back for transform cards */
  showBack?: boolean;
}

// Standard Magic card dimensions
const CARD_WIDTH = 312;
const CARD_HEIGHT = 445;

export const CustomCardPreview = memo(function CustomCardPreview({
  card,
  className,
  scale = 1,
  interactive = false,
  showBack = false,
}: CustomCardPreviewProps) {
  const width = CARD_WIDTH * scale;
  const height = CARD_HEIGHT * scale;

  // Determine frame colors based on card colors
  const frameColors = useMemo(() => {
    if (card.colors.length === 0 || card.colors.includes('colorless')) {
      return FRAME_STYLE_COLORS[card.frameStyle];
    }
    
    // Determine frame based on color identity
    const colorSet = new Set(card.colors);
    const hasWhite = colorSet.has('white');
    const hasBlue = colorSet.has('blue');
    const hasBlack = colorSet.has('black');
    const hasRed = colorSet.has('red');
    const hasGreen = colorSet.has('green');
    
    // Multi-color frame
    if (card.colors.length > 1) {
      return {
        background: '#e8d8b8',
        border: '#000000',
        text: '#000000',
      };
    }
    
    // Single color frames
    if (hasWhite) return { background: '#f8f6d8', border: '#000000', text: '#000000' };
    if (hasBlue) return { background: '#c8d8e8', border: '#000000', text: '#000000' };
    if (hasBlack) return { background: '#c8c8c8', border: '#000000', text: '#000000' };
    if (hasRed) return { background: '#e8c8c8', border: '#000000', text: '#000000' };
    if (hasGreen) return { background: '#c8e8c8', border: '#000000', text: '#000000' };
    
    return FRAME_STYLE_COLORS[card.frameStyle];
  }, [card.colors, card.frameStyle]);

  // Parse mana cost into symbols
  const manaSymbols = useMemo(() => {
    if (!card.manaCost) return [];
    
    const symbols: { type: string; value: string }[] = [];
    const cost = card.manaCost;
    
    // Match hybrid mana
    const hybridMatch = cost.match(/\{([0-9WUBRGC])\/([WUBRGC])\}/g);
    if (hybridMatch) {
      hybridMatch.forEach(match => {
        symbols.push({ type: 'hybrid', value: match });
      });
    }
    
    // Match Phyrexian mana
    const phyrexianMatch = cost.match(/\{[WUBRG]\/P\}/gi);
    if (phyrexianMatch) {
      phyrexianMatch.forEach(match => {
        symbols.push({ type: 'phyrexian', value: match });
      });
    }
    
    // Match regular mana
    const regularMatch = cost.match(/\{[0-9WUBRGC]\}/gi);
    if (regularMatch) {
      regularMatch.forEach(match => {
        const value = match.replace(/[{}]/g, '');
        if (!isNaN(parseInt(value))) {
          symbols.push({ type: 'numeric', value });
        } else {
          symbols.push({ type: 'color', value });
        }
      });
    }
    
    return symbols;
  }, [card.manaCost]);

  // Get color indicator background
  const colorIndicatorStyle = useMemo(() => {
    if (!card.colorIndicator || card.colorIndicator.length === 0) {
      return null;
    }
    
    if (card.colorIndicator.length === 1) {
      return CARD_COLORS[card.colorIndicator[0]].hex;
    }
    
    // Multi-color indicator
    return `linear-gradient(to right, ${card.colorIndicator.map(c => CARD_COLORS[c].hex).join(', ')})`;
  }, [card.colorIndicator]);

  // Get rarity symbol
  const raritySymbol = useMemo(() => {
    switch (card.rarity) {
      case 'common': return '●';
      case 'uncommon': return '◆';
      case 'rare': return '★';
      case 'mythic': return '★';
      default: return '●';
    }
  }, [card.rarity]);

  // Parse oracle text for reminder text formatting
  const formattedOracleText = useMemo(() => {
    if (!card.oracleText) return [];
    return card.oracleText.split('\n');
  }, [card.oracleText]);

  // Handle transform card back
  if (showBack && card.backFace) {
    return (
      <CustomCardPreview
        card={card.backFace}
        className={className}
        scale={scale}
        interactive={interactive}
        showBack={false}
      />
    );
  }

  return (
    <div
      className={cn(
        'relative rounded-lg overflow-hidden select-none',
        interactive && 'hover:shadow-2xl hover:shadow-primary/20 transition-all duration-200 cursor-pointer',
        className
      )}
      style={{
        width,
        height,
        background: frameColors.background,
        border: `2px solid ${frameColors.border}`,
        fontFamily: 'Beleren, Matrix, sans-serif',
      }}
    >
      {/* Card border frame */}
      <div
        className="absolute inset-1 rounded-sm"
        style={{ border: `1px solid ${frameColors.border}` }}
      >
        {/* Color indicator bar (for older frames) */}
        {card.frameStyle === 'old' && colorIndicatorStyle && (
          <div
            className="absolute top-1 left-1 right-1 h-1.5"
            style={{ background: colorIndicatorStyle }}
          />
        )}
        
        {/* Card name bar */}
        <div
          className="absolute top-1.5 left-2 right-2 h-5 rounded-sm flex items-center justify-between px-1"
          style={{
            background: frameColors.background,
            border: `1px solid ${frameColors.border}`,
          }}
        >
          <span
            className="text-xs font-bold truncate"
            style={{ color: frameColors.text, fontSize: scale * 11 }}
          >
            {card.name || 'Card Name'}
          </span>
          {/* Mana cost */}
          <div className="flex items-center gap-0.5">
            {manaSymbols.map((symbol, i) => (
              <ManaSymbol key={i} symbol={symbol} size={scale * 12} />
            ))}
          </div>
        </div>

        {/* Card art area */}
        <div
          className="absolute top-[30px] left-2 right-2 h-[175px] rounded-sm overflow-hidden"
          style={{ border: `1px solid ${frameColors.border}` }}
        >
          {card.art.imageUrl ? (
            <img
              src={card.art.imageUrl}
              alt={card.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div
              className="w-full h-full flex items-center justify-center"
              style={{
                background: card.art.useProceduralArt
                  ? `linear-gradient(135deg, ${card.art.proceduralColors?.map(c => CARD_COLORS[c]?.hex || '#ccc').join(', ') || '#ccc'})`
                  : frameColors.background,
              }}
            >
              <span className="text-3xl" style={{ fontSize: scale * 40 }}>
                {card.cardTypes.includes('creature') ? '🦄' :
                 card.cardTypes.includes('instant') ? '⚡' :
                 card.cardTypes.includes('sorcery') ? '🔮' :
                 card.cardTypes.includes('artifact') ? '⚙️' :
                 card.cardTypes.includes('enchantment') ? '✨' :
                 card.cardTypes.includes('planeswalker') ? '🧙' :
                 card.cardTypes.includes('land') ? '🏔️' : '🃏'}
              </span>
            </div>
          )}
        </div>

        {/* Type line */}
        <div
          className="absolute top-[212px] left-2 right-2 h-4 rounded-sm flex items-center justify-between px-1"
          style={{
            background: frameColors.background,
            border: `1px solid ${frameColors.border}`,
          }}
        >
          <span
            className="text-xs truncate"
            style={{ color: frameColors.text, fontSize: scale * 9 }}
          >
            {card.typeLine || 'Type Line'}
          </span>
          {/* Collector number / set info */}
          <span
            className="text-xs"
            style={{ color: frameColors.text, fontSize: scale * 8 }}
          >
            {card.setCode}/{card.collectorNumber || '001'}
          </span>
        </div>

        {/* Oracle text box */}
        <div
          className="absolute top-[242px] left-2 right-2 bottom-10 rounded-sm p-1.5 overflow-hidden"
          style={{
            background: '#d8d8c8',
            border: `1px solid ${frameColors.border}`,
          }}
        >
          {/* Oracle text */}
          <div className="space-y-0.5">
            {formattedOracleText.map((line, i) => (
              <p
                key={i}
                className="text-xs leading-tight"
                style={{
                  color: card.typography?.textColor || frameColors.text,
                  fontSize: scale * (card.typography?.textSize || 9),
                  fontFamily: card.typography?.textFont || 'Beleren',
                }}
              >
                {line}
              </p>
            ))}
          </div>
          
          {/* Flavor text (if present) */}
          {card.flavorText && (
            <div
              className="mt-1 pt-1 border-t border-black/20 italic text-xs"
              style={{ color: '#555' }}
            >
              {card.flavorText}
            </div>
          )}
          
          {/* Power/Toughness */}
          {card.power && card.toughness && (
            <div className="absolute bottom-1 right-1">
              <span
                className="text-sm font-bold"
                style={{
                  color: frameColors.text,
                  fontSize: scale * 14,
                }}
              >
                {card.power}/{card.toughness}
              </span>
            </div>
          )}
          
          {/* Loyalty (planeswalkers) */}
          {card.loyalty && (
            <div className="absolute bottom-1 right-1">
              <span
                className="text-sm font-bold px-1 rounded"
                style={{
                  background: '#e8e8d8',
                  color: frameColors.text,
                  fontSize: scale * 12,
                }}
              >
                {card.loyalty}
              </span>
            </div>
          )}
        </div>

        {/* Artist and copyright */}
        <div
          className="absolute bottom-1 left-2 right-2 flex justify-between text-[8px]"
          style={{ color: frameColors.text }}
        >
          <span>{card.artist || 'Artist'}</span>
          <span>{card.copyright || '© Custom'}</span>
        </div>

        {/* Rarity indicator */}
        <div
          className="absolute bottom-1 left-2"
          style={{ color: RARITY_COLORS[card.rarity] }}
        >
          {raritySymbol}
        </div>
      </div>
    </div>
  );
});

// Mana symbol component
function ManaSymbol({ symbol, size }: { symbol: { type: string; value: string }; size: number }) {
  const getSymbolColor = () => {
    switch (symbol.type) {
      case 'color':
        switch (symbol.value.toUpperCase()) {
          case 'W': return '#f9f9f9';
          case 'U': return '#0e68ab';
          case 'B': return '#150b00';
          case 'R': return '#d3202a';
          case 'G': return '#00733e';
          default: return '#000';
        }
      case 'hybrid':
        return '#ccc';
      case 'phyrexian':
        return '#69f';
      default:
        return '#000';
    }
  };

  const getBackground = () => {
    if (symbol.type === 'color' || symbol.type === 'phyrexian') {
      const color = getSymbolColor();
      return `radial-gradient(circle at 30% 30%, ${color}, #000)`;
    }
    if (symbol.type === 'hybrid') {
      return 'linear-gradient(135deg, #fff 50%, #000 50%)';
    }
    return '#000';
  };

  return (
    <div
      className="rounded-full flex items-center justify-center font-bold"
      style={{
        width: size,
        height: size,
        background: symbol.type === 'numeric' ? '#000' : getBackground(),
        color: symbol.type === 'color' || symbol.type === 'phyrexian' ? '#fff' : 
               symbol.type === 'numeric' ? '#fff' : '#000',
        fontSize: size * 0.7,
        border: '1px solid #000',
      }}
    >
      {symbol.type === 'numeric' ? symbol.value : ''}
    </div>
  );
}

export default CustomCardPreview;
