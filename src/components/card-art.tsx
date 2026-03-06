'use client';

import { useState, useEffect, useCallback, useMemo, memo, useRef } from 'react';
import { cn } from '@/lib/utils';
import {
  getOrGenerateArtwork,
  clearArtworkCache,
  getArtworkCacheStats,
  isArtworkCacheReady,
  type ProceduralArtworkConfig,
} from '@/lib/artwork-cache';

/**
 * Card Art Display Component
 *
 * Issue #288: Feature: Add card art display and high-res rendering
 * Issue #438: Unit 4: Original Artwork Generation System
 *
 * Provides:
 * - Procedurally generated SVG-based artwork (legal-safe)
 * - Fallback to local images (user-provided)
 * - Fallback to Scryfall images (legacy)
 * - Lazy loading for performance optimization
 * - Multiple size variants
 * - Zoom/pan functionality for detailed view
 * - Caching for generated artwork
 */

export interface CardArtProps {
  /** Card name for display and alt text */
  cardName: string;
  /** Scryfall image URI (legacy fallback) */
  imageUri?: string;
  /** Card type line for artwork generation */
  typeLine?: string;
  /** Color identity for artwork generation */
  colors?: string[];
  /** Converted mana cost for artwork complexity */
  cmc?: number;
  /** Image size variant */
  size?: 'thumbnail' | 'small' | 'normal' | 'large' | 'full';
  /** Enable lazy loading */
  lazy?: boolean;
  /** Show card back (face down) */
  showBack?: boolean;
  /** Enable zoom on click */
  enableZoom?: boolean;
  /** Custom class name */
  className?: string;
  /** Click handler */
  onClick?: () => void;
  /** Hover handler */
  onHover?: (isHovering: boolean) => void;
  /** Show loading skeleton */
  showSkeleton?: boolean;
  /** High DPI support */
  highDpi?: boolean;
  /** Use procedural artwork generation */
  useProceduralArt?: boolean;
  /** Variant number for procedural artwork (for multiple versions) */
  proceduralVariant?: number;
  /** Scryfall card object for legacy image resolution */
  scryfallCard?: {
    id: string;
    set?: string;
    collector_number?: string;
    name: string;
    color_identity?: string[];
  };
}

// Size configurations with dimensions and quality
const SIZE_CONFIG = {
  thumbnail: { width: 146, height: 204, quality: 60, scryfallSize: 'small' },
  small: { width: 204, height: 285, quality: 70, scryfallSize: 'small' },
  normal: { width: 244, height: 340, quality: 80, scryfallSize: 'normal' },
  large: { width: 488, height: 680, quality: 90, scryfallSize: 'large' },
  full: { width: 744, height: 1039, quality: 95, scryfallSize: 'large' },
} as const;

// Intersection Observer for lazy loading
let lazyLoadObserver: IntersectionObserver | null = null;

function getLazyLoadObserver() {
  if (typeof window === 'undefined') return null;

  if (!lazyLoadObserver) {
    lazyLoadObserver = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            const target = entry.target as HTMLElement;
            target.dataset.visible = 'true';
            lazyLoadObserver?.unobserve(target);
          }
        });
      },
      { rootMargin: '100px', threshold: 0.1 }
    );
  }
  return lazyLoadObserver;
}

// Loading skeleton component
const CardSkeleton = memo(function CardSkeleton({
  size,
  className
}: {
  size: keyof typeof SIZE_CONFIG;
  className?: string;
}) {
  const config = SIZE_CONFIG[size];

  return (
    <div
      className={cn(
        'bg-gradient-to-br from-muted to-muted/50 animate-pulse rounded-lg',
        className
      )}
      style={{ width: config.width, height: config.height }}
      role="presentation"
      aria-hidden="true"
    >
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-1/2 h-1/4 bg-muted-foreground/20 rounded" />
      </div>
    </div>
  );
});

// Error fallback component
const CardError = memo(function CardError({
  cardName,
  size,
  className
}: {
  cardName: string;
  size: keyof typeof SIZE_CONFIG;
  className?: string;
}) {
  const config = SIZE_CONFIG[size];

  return (
    <div
      className={cn(
        'bg-gradient-to-br from-destructive/20 to-destructive/10 border border-destructive/30 rounded-lg',
        'flex flex-col items-center justify-center p-2 text-center',
        className
      )}
      style={{ width: config.width, height: config.height }}
      role="img"
      aria-label={`${cardName} - Image not available`}
    >
      <span className="text-2xl mb-1">🃏</span>
      <span className="text-xs text-muted-foreground truncate max-w-full">
        {cardName}
      </span>
    </div>
  );
});

// Card back component
const CardBack = memo(function CardBack({
  size,
  className
}: {
  size: keyof typeof SIZE_CONFIG;
  className?: string;
}) {
  const config = SIZE_CONFIG[size];

  return (
    <div
      className={cn(
        'bg-gradient-to-br from-primary/30 to-primary/10 border border-primary/30 rounded-lg',
        'flex items-center justify-center',
        className
      )}
      style={{ width: config.width, height: config.height }}
      role="img"
      aria-label="Card back"
    >
      <svg width={config.width} height={config.height} viewBox="0 0 480 680">
        <defs>
          <linearGradient id="cardBackGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" style={{ stopColor: '#3A3A3C', stopOpacity: 1 }} />
            <stop offset="100%" style={{ stopColor: '#636366', stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        <rect width="480" height="680" fill="url(#cardBackGradient)" rx="20" />
        <rect x="20" y="20" width="440" height="640" fill="none" stroke="#8E8E93" strokeWidth="4" rx="15" />
        <circle cx="240" cy="340" r="100" fill="none" stroke="#AEAEB2" strokeWidth="3" />
        <circle cx="240" cy="340" r="80" fill="none" stroke="#C7C7CC" strokeWidth="2" />
        <circle cx="240" cy="340" r="60" fill="none" stroke="#8E8E93" strokeWidth="1" />
      </svg>
    </div>
  );
});

// Main CardArt component
export const CardArt = memo(function CardArt({
  cardName,
  imageUri,
  typeLine,
  colors,
  cmc = 0,
  scryfallCard,
  size = 'normal',
  lazy = true,
  showBack = false,
  enableZoom = false,
  className,
  onClick,
  onHover,
  showSkeleton = true,
  highDpi = true,
  useProceduralArt = true,
  proceduralVariant = 0,
}: CardArtProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [isVisible, setIsVisible] = useState(!lazy);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [proceduralImageUrl, setProceduralImageUrl] = useState<string | null>(null);
  const [isCacheReady, setIsCacheReady] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const config = SIZE_CONFIG[size];

  // Initialize artwork cache
  useEffect(() => {
    if (useProceduralArt) {
      isArtworkCacheReady().then(setIsCacheReady);
    }
  }, [useProceduralArt]);

  // Setup lazy loading observer
  useEffect(() => {
    if (!lazy || isVisible) return;

    const observer = getLazyLoadObserver();
    const element = containerRef.current;

    if (observer && element) {
      observer.observe(element);

      // Check if already visible
      const checkVisibility = () => {
        if (element.dataset.visible === 'true') {
          setIsVisible(true);
        }
      };

      const interval = setInterval(checkVisibility, 100);
      return () => {
        observer.unobserve(element);
        clearInterval(interval);
      };
    }
  }, [lazy, isVisible]);

  // Generate procedural artwork
  useEffect(() => {
    if (useProceduralArt && isVisible && isCacheReady && !showBack) {
      const generateArtwork = async () => {
        try {
          const artConfig: ProceduralArtworkConfig = {
            cardName,
            typeLine: typeLine || scryfallCard?.type_line || 'Unknown',
            colors: colors || scryfallCard?.color_identity || [],
            cmc,
            width: config.width,
            height: config.height,
            variant: proceduralVariant,
          };

          const dataUri = await getOrGenerateArtwork(artConfig);
          setProceduralImageUrl(dataUri);
          setIsLoading(false);
          setHasError(false);
        } catch (error) {
          console.error('Failed to generate procedural artwork:', error);
          setIsLoading(false);
          setHasError(true);
        }
      };

      generateArtwork();
    }
  }, [
    useProceduralArt,
    isVisible,
    isCacheReady,
    showBack,
    cardName,
    typeLine,
    colors,
    cmc,
    scryfallCard,
    config.width,
    config.height,
    proceduralVariant,
  ]);

  // Build image URL (legacy fallback)
  const legacyImageUrl = useMemo(() => {
    if (showBack || useProceduralArt) return null;

    // If we have a direct Scryfall URI, use it
    if (imageUri) {
      // Scryfall provides different sizes via URL parameters
      const sizeParam = config.scryfallSize;
      // Handle different URI formats
      if (imageUri.includes('scryfall')) {
        return imageUri.replace('/normal/', `/${sizeParam}/`).replace('/large/', `/${sizeParam}/`);
      }
      return imageUri;
    }

    return null;
  }, [imageUri, showBack, useProceduralArt, config.scryfallSize]);

  // Determine final image URL
  const finalImageUrl = proceduralImageUrl || legacyImageUrl;

  // Handle image load
  const handleLoad = useCallback(() => {
    setIsLoading(false);
    setHasError(false);
  }, []);

  // Handle image error
  const handleError = useCallback(() => {
    // If procedural artwork fails, try legacy
    if (useProceduralArt && proceduralImageUrl && !legacyImageUrl) {
      setIsLoading(false);
      setHasError(true);
    } else {
      setIsLoading(false);
      setHasError(true);
    }
  }, [useProceduralArt, proceduralImageUrl, legacyImageUrl]);

  // Handle zoom toggle
  const handleZoomToggle = useCallback(() => {
    if (enableZoom) {
      setIsZoomed(prev => !prev);
    }
  }, [enableZoom]);

  // Handle hover
  const handleMouseEnter = useCallback(() => {
    setIsHovering(true);
    onHover?.(true);
  }, [onHover]);

  const handleMouseLeave = useCallback(() => {
    setIsHovering(false);
    onHover?.(false);
  }, [onHover]);

  // Show card back if requested
  if (showBack) {
    return <CardBack size={size} className={className} />;
  }

  // Show skeleton while loading
  if (showSkeleton && isLoading && isVisible) {
    return (
      <div ref={containerRef} className={cn('relative', className)}>
        <CardSkeleton size={size} />
      </div>
    );
  }

  // Show error state
  if (hasError || !finalImageUrl) {
    return <CardError cardName={cardName} size={size} className={className} />;
  }

  // Not yet visible (lazy loading)
  if (!isVisible) {
    return (
      <div ref={containerRef} className={className}>
        <CardSkeleton size={size} />
      </div>
    );
  }

  return (
    <>
      <div
        ref={containerRef}
        className={cn(
          'relative overflow-hidden rounded-lg transition-all duration-200',
          'hover:shadow-lg hover:shadow-primary/20',
          isHovering && 'ring-2 ring-primary/50',
          onClick && 'cursor-pointer',
          className
        )}
        style={{ width: config.width, height: config.height }}
        onClick={onClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        role="img"
        aria-label={cardName}
      >
        <img
          src={finalImageUrl}
          alt={cardName}
          className={cn(
            'w-full h-full object-contain transition-transform duration-200',
            isHovering && 'scale-105'
          )}
          onLoad={handleLoad}
          onError={handleError}
          loading={lazy ? 'lazy' : 'eager'}
          srcSet={highDpi && !finalImageUrl.startsWith('data:') ? `${finalImageUrl} 1x, ${finalImageUrl} 2x` : undefined}
        />

        {/* Zoom button */}
        {enableZoom && (
          <button
            onClick={(e) => {
              e.stopPropagation();
              handleZoomToggle();
            }}
            className={cn(
              'absolute bottom-2 right-2 p-1.5 rounded-full',
              'bg-background/80 hover:bg-background transition-opacity',
              'opacity-0 group-hover:opacity-100',
              isHovering && 'opacity-100'
            )}
            aria-label="Zoom card"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="11" cy="11" r="8" />
              <line x1="21" y1="21" x2="16.65" y2="16.65" />
              <line x1="11" y1="8" x2="11" y2="14" />
              <line x1="8" y1="11" x2="14" y2="11" />
            </svg>
          </button>
        )}
      </div>

      {/* Zoomed modal */}
      {isZoomed && enableZoom && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80"
          onClick={handleZoomToggle}
        >
          <img
            src={finalImageUrl}
            alt={cardName}
            className="max-w-[90vw] max-h-[90vh] object-contain rounded-lg shadow-2xl"
          />
          <button
            className="absolute top-4 right-4 p-2 rounded-full bg-white/10 hover:bg-white/20 text-white"
            onClick={handleZoomToggle}
            aria-label="Close zoom"
          >
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
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
      )}
    </>
  );
});

// Scryfall card type for gallery
interface ScryfallCardData {
  id: string;
  set?: string;
  collector_number?: string;
  name: string;
  type_line?: string;
  color_identity?: string[];
}

// Card Art Gallery for displaying multiple cards
export interface CardArtGalleryProps {
  cards: Array<{
    id: string;
    name: string;
    imageUri?: string;
    typeLine?: string;
    colors?: string[];
    cmc?: number;
    scryfallCard?: ScryfallCardData;
  }>;
  size?: 'thumbnail' | 'small' | 'normal';
  enableZoom?: boolean;
  useProceduralArt?: boolean;
  className?: string;
  onCardClick?: (cardId: string) => void;
}

export const CardArtGallery = memo(function CardArtGallery({
  cards,
  size = 'small',
  enableZoom = true,
  useProceduralArt = true,
  className,
  onCardClick,
}: CardArtGalleryProps) {
  return (
    <div
      className={cn(
        'grid gap-2',
        size === 'thumbnail' && 'grid-cols-6 sm:grid-cols-8 md:grid-cols-10',
        size === 'small' && 'grid-cols-4 sm:grid-cols-6 md:grid-cols-8',
        size === 'normal' && 'grid-cols-3 sm:grid-cols-4 md:grid-cols-6',
        className
      )}
    >
      {cards.map((card) => (
        <CardArt
          key={card.id}
          cardName={card.name}
          imageUri={card.imageUri}
          typeLine={card.typeLine || card.scryfallCard?.type_line}
          colors={card.colors || card.scryfallCard?.color_identity}
          cmc={card.cmc}
          scryfallCard={card.scryfallCard}
          size={size}
          lazy
          enableZoom={enableZoom}
          useProceduralArt={useProceduralArt}
          onClick={() => onCardClick?.(card.id)}
        />
      ))}
    </div>
  );
});

// Hook for preloading card images
export function useCardImagePreloader() {
  const [preloadedImages, setPreloadedImages] = useState<Set<string>>(new Set());

  const preloadImages = useCallback((urls: string[]) => {
    urls.forEach((url) => {
      if (!preloadedImages.has(url)) {
        const img = new Image();
        img.src = url;
        img.onload = () => {
          setPreloadedImages((prev) => new Set(prev).add(url));
        };
      }
    });
  }, [preloadedImages]);

  return { preloadedImages, preloadImages };
}

// Export cache utilities for external use
export const artworkCache = {
  clear: clearArtworkCache,
  getStats: getArtworkCacheStats,
  isReady: isArtworkCacheReady,
};

export default CardArt;
