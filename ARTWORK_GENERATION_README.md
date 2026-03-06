# Procedural Artwork Generation System

## Overview

This system provides legal-safe, procedurally generated SVG-based card artwork for Planar Nexus. It replaces MTG card images with original artwork that is deterministic, consistent, and fully generated client-side.

## Features

### Core Capabilities

- **Procedural Generation**: Creates unique artwork based on card properties
- **Deterministic Output**: Same card always generates same artwork (same seed)
- **Type-Specific Styling**: Different visual styles for creatures, spells, artifacts, etc.
- **Color Identity Support**: Artwork reflects card's color(s)
- **Variants Support**: Generate multiple versions of the same card
- **Performance Caching**: IndexedDB + in-memory cache for fast access
- **Zero External Dependencies**: No API calls, no external images
- **Legal Compliance**: All artwork is original and CC0-compliant

### Artwork Style Presets

The system includes distinct visual styles for different card types:

| Card Type | Background | Pattern Density | Elements | Organic | Symmetry |
|-----------|------------|------------------|-----------|----------|----------|
| Creature | Portrait | High | Many | Yes | None |
| Instant | Action | Medium | Moderate | No | Radial |
| Sorcery | Scene | High | Many | Yes | None |
| Artifact | Geometric | Very High | Few | No | Rotational |
| Enchantment | Ethereal | Medium | Moderate | Yes | Radial |
| Land | Landscape | Low | Few | Yes | None |
| Planeswalker | Portrait | High | Many | Yes | Bilateral |
| Battle | Action | Very High | Many | No | None |

### Color Palettes

Each color identity has a dedicated color palette:

- **White (W)**: Light grays and whites (#F8F9FA, #E9ECEF)
- **Blue (U)**: Blues (#0A84FF, #64D2FF)
- **Black (B)**: Dark grays (#636366, #8E8E93)
- **Red (R)**: Reds (#FF453A, #FF6961)
- **Green (G)**: Greens (#30D158, #63E6BE)
- **Colorless**: Neutrals (#8E8E93, #C7C7CC)
- **Multicolor**: Purples (#BF5AF2, #DA70D6)

## Architecture

### Core Modules

#### 1. `procedural-art-generator.ts`

**Purpose**: Core procedural generation logic

**Key Functions**:
- `generateProceduralArtwork(config)`: Generate SVG artwork
- `generateArtworkDataUri(config)`: Generate and convert to data URI
- `generateArtworkVariants(config, count)`: Generate multiple versions

**Components**:
- `SeededRandom`: Deterministic random number generator
- Color palette definitions
- Artwork style presets
- Background generation algorithms
- Decorative element generation
- Pattern overlay generation

#### 2. `artwork-cache.ts`

**Purpose**: Performance caching system

**Key Functions**:
- `getOrGenerateArtwork(config)`: Get from cache or generate
- `cacheArtwork(config, dataUri)`: Cache generated artwork
- `clearArtworkCache()`: Clear all cached artwork
- `getArtworkCacheStats()`: Get cache statistics
- `preGenerateArtwork(configs)`: Pre-generate for multiple cards

**Storage**:
- **Memory Cache**: Fast access for frequently used cards (100 item limit)
- **IndexedDB**: Persistent storage for all generated artwork
- **Access Tracking**: Tracks access frequency for smart caching

#### 3. `card-art.tsx` (Updated)

**Purpose**: React component for displaying card artwork

**New Props**:
- `useProceduralArt`: Enable procedural generation (default: true)
- `proceduralVariant`: Variant number for multiple versions
- `typeLine`: Card type line for style selection
- `colors`: Color identity array
- `cmc`: Converted mana cost for complexity

**Fallback Chain**:
1. Procedural artwork (primary)
2. Local user images (secondary)
3. Scryfall images (legacy fallback)

## Usage

### Basic Usage

```tsx
import { CardArt } from '@/components/card-art';

<CardArt
  cardName="Lightning Bolt"
  typeLine="Instant"
  colors={['R']}
  cmc={1}
  size="normal"
  useProceduralArt={true}
/>
```

### Generate Variants

```tsx
// Variant 1
<CardArt
  cardName="Lightning Bolt"
  typeLine="Instant"
  colors={['R']}
  cmc={1}
  proceduralVariant={0}
/>

// Variant 2
<CardArt
  cardName="Lightning Bolt"
  typeLine="Instant"
  colors={['R']}
  cmc={1}
  proceduralVariant={1}
/>
```

### Gallery Display

```tsx
import { CardArtGallery } from '@/components/card-art';

<CardArtGallery
  cards={cardList}
  size="small"
  useProceduralArt={true}
  onCardClick={(cardId) => handleCardSelect(cardId)}
/>
```

### Cache Management

```tsx
import { artworkCache } from '@/components/card-art';

// Get cache statistics
const stats = await artworkCache.getStats();
console.log(`${stats.memoryCacheSize} items in memory cache`);
console.log(`${stats.dbCacheSize} items in database`);
console.log(`Total size: ${stats.totalSizeEstimate}`);

// Clear all cache
await artworkCache.clear();

// Check if cache is ready
const ready = artworkCache.isReady();
```

## Advanced Features

### Custom Artwork Configuration

```tsx
import { generateArtworkDataUri, type ProceduralArtworkConfig } from '@/lib/procedural-art-generator';

const config: ProceduralArtworkConfig = {
  cardName: 'Custom Card',
  typeLine: 'Creature — Dragon',
  colors: ['R', 'G'],
  cmc: 5,
  width: 480,
  height: 680,
  variant: 0,
};

const dataUri = generateArtworkDataUri(config);
```

### Pre-Generation for Performance

```tsx
import { preGenerateArtwork, type ProceduralArtworkConfig } from '@/lib/artwork-cache';

// Pre-generate artwork for deck
const configs: ProceduralArtworkConfig[] = deckCards.map(card => ({
  cardName: card.name,
  typeLine: card.typeLine,
  colors: card.colors,
  cmc: card.cmc,
}));

await preGenerateArtwork(configs);
```

### Cache Export/Import

```tsx
import { exportArtworkCache, importArtworkCache } from '@/lib/artwork-cache';

// Export cache (for backup/transfer)
const exportedCache = await exportArtworkCache();

// Import cache (from backup/transfer)
await importArtworkCache(exportedCache);
```

### Cache Maintenance

```tsx
import { clearOldArtworkCache } from '@/lib/artwork-cache';

// Clear cache entries older than 30 days
const deletedCount = await clearOldArtworkCache(30);
console.log(`Deleted ${deletedCount} old cache entries`);
```

## Performance Characteristics

### Generation Time

- **First Generation**: ~10-50ms per card (depends on complexity)
- **Cached Retrieval**: ~1-2ms from memory cache
- **Database Retrieval**: ~5-10ms from IndexedDB

### Cache Size

- **Memory Cache**: ~100 items (configurable)
- **Database Cache**: Unlimited (persistent)
- **Storage per Card**: ~5-10KB (SVG data URI)

### Optimization Tips

1. **Pre-generate frequently used cards**: Reduces runtime generation
2. **Enable memory cache**: Fastest access for common cards
3. **Use variants sparingly**: Each variant requires separate cache entry
4. **Clear old cache periodically**: Frees up storage space
5. **Export cache for backup**: Preserve generated artwork

## Customization

### Adding New Color Palettes

Edit `procedural-art-generator.ts`:

```typescript
const COLOR_PALETTES = {
  // ... existing palettes
  custom: {
    primary: '#YOUR_COLOR',
    secondary: '#YOUR_COLOR',
    accent: '#YOUR_COLOR',
    gradient: ['#YOUR_COLOR', '#YOUR_COLOR'],
  },
};
```

### Adding New Style Presets

Edit `procedural-art-generator.ts`:

```typescript
const ARTWORK_STYLES: Record<CardTypeCategory, StylePreset> = {
  // ... existing styles
  customType: {
    backgroundType: 'geometric',
    patternDensity: 'high',
    elementCount: 'many',
    organic: false,
    symmetry: 'radial',
  },
};
```

### Modifying Generation Algorithms

The generation functions are modular and can be customized:

- `generateBackground()`: Create custom background types
- `generateDecorativeElements()`: Add new element shapes
- `generatePatternOverlay()`: Create custom patterns

## Demo

A comprehensive demo is available at `/artwork-demo` which showcases:

- All card types with different colors
- Variant generation
- Cache statistics
- Performance testing
- Real-time artwork generation

Access the demo by running the development server:

```bash
npm run dev
```

Then navigate to `http://localhost:9002/artwork-demo`

## Legal Compliance

### CC0 License

All procedurally generated artwork is:
- **Original**: Created by algorithms, not derived from copyrighted material
- **Reusable**: Can be used in any context without attribution
- **Modifiable**: Can be modified and redistributed
- **Commercial-safe**: Suitable for commercial applications

### Why This Approach?

1. **No Copyright Infringement**: No MTG card images or artwork
2. **No External Dependencies**: No API calls or asset downloads
3. **Fully Client-Side**: Works offline, no server requirements
4. **Deterministic**: Consistent artwork across sessions
5. **Performant**: Fast generation with intelligent caching

## Troubleshooting

### Artwork Not Displaying

**Problem**: Card shows error or skeleton

**Solutions**:
1. Check browser console for errors
2. Ensure `useProceduralArt={true}` is set
3. Verify artwork cache is initialized
4. Try clearing cache and regenerating

### Poor Performance

**Problem**: Slow generation or display

**Solutions**:
1. Pre-generate frequently used cards
2. Increase memory cache size
3. Reduce number of simultaneous generations
4. Check for memory leaks in cache

### Cache Issues

**Problem**: Cache not working or corrupted

**Solutions**:
1. Clear cache: `await artworkCache.clear()`
2. Check IndexedDB quota
3. Clear browser storage
4. Reinitialize cache: `await initializeArtworkCache()`

## Future Enhancements

Potential improvements for the artwork system:

1. **AI-Assisted Generation**: Use AI to enhance procedural algorithms
2. **User Customization**: Allow users to tweak generation parameters
3. **More Color Palettes**: Additional color schemes and themes
4. **Advanced Patterns**: Fractal and tessellation-based patterns
5. **Animated Artwork**: SVG animations for special cards
6. **High-Resolution Support**: 4K and beyond artwork generation
7. **Style Transfer**: Apply artistic styles to generated artwork
8. **Community Styles**: Shareable style presets

## Contributing

When contributing to the artwork system:

1. **Test thoroughly**: Verify artwork generation for all card types
2. **Check performance**: Ensure caching works efficiently
3. **Maintain compatibility**: Don't break existing API
4. **Document changes**: Update README and comments
5. **Test offline**: Verify system works without internet

## License

This artwork generation system is part of Planar Nexus and is licensed under the project's main license. All generated artwork is CC0 (public domain).

## Support

For issues or questions about the artwork generation system:

1. Check this documentation
2. Review the demo page
3. Examine source code comments
4. Open an issue on GitHub
5. Contact the development team

---

**Issue Reference**: #438 - Unit 4: Original Artwork Generation System
