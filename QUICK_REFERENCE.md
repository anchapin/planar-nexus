# Quick Reference: Procedural Artwork Generation

## Quick Start

### Display Card with Procedural Art

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
<CardArt
  cardName="Lightning Bolt"
  typeLine="Instant"
  colors={['R']}
  cmc={1}
  proceduralVariant={0}  // Version 1
/>

<CardArt
  cardName="Lightning Bolt"
  typeLine="Instant"
  colors={['R']}
  cmc={1}
  proceduralVariant={1}  // Version 2
/>
```

## Component Props

### Required Props
- `cardName`: string - Card name for display

### Recommended Props (for best procedural art)
- `typeLine`: string - Card type line (e.g., "Creature — Dragon")
- `colors`: string[] - Color identity (e.g., ['R', 'G'])
- `cmc`: number - Converted mana cost

### Optional Props
- `useProceduralArt`: boolean - Enable procedural generation (default: true)
- `proceduralVariant`: number - Variant number for multiple versions
- `size`: 'thumbnail' | 'small' | 'normal' | 'large' | 'full'
- `enableZoom`: boolean - Enable zoom on click
- `lazy`: boolean - Enable lazy loading

## Cache Management

```tsx
import { artworkCache } from '@/components/card-art';

// Get cache statistics
const stats = await artworkCache.getStats();
console.log(stats.memoryCacheSize);  // Memory cache size
console.log(stats.dbCacheSize);       // Database cache size
console.log(stats.totalSizeEstimate); // Total size estimate

// Clear all cache
await artworkCache.clear();

// Check if cache is ready
const ready = artworkCache.isReady();
```

## Direct Artwork Generation

```tsx
import { generateArtworkDataUri } from '@/lib/procedural-art-generator';

const dataUri = generateArtworkDataUri({
  cardName: 'Custom Card',
  typeLine: 'Creature — Dragon',
  colors: ['R', 'G'],
  cmc: 5,
  width: 480,
  height: 680,
  variant: 0,
});
```

## Pre-Generation for Performance

```tsx
import { preGenerateArtwork } from '@/lib/artwork-cache';

const configs = deckCards.map(card => ({
  cardName: card.name,
  typeLine: card.typeLine,
  colors: card.colors,
  cmc: card.cmc,
}));

await preGenerateArtwork(configs);
```

## Artwork Styles

| Card Type | Style Description |
|-----------|------------------|
| Creature | Portrait with organic elements, high density |
| Instant | Action-oriented with radial symmetry |
| Sorcery | Scene-based with many elements |
| Artifact | Geometric patterns, rotational symmetry |
| Enchantment | Ethereal with radial symmetry |
| Land | Landscape with few elements |
| Planeswalker | Portrait with bilateral symmetry |
| Battle | Action with very high density |

## Color Palettes

- **W**: Light grays and whites
- **U**: Blues
- **B**: Dark grays
- **R**: Reds
- **G**: Greens
- **Colorless**: Neutrals
- **Multicolor**: Purples

## Common Patterns

### Display Card Gallery

```tsx
import { CardArtGallery } from '@/components/card-art';

<CardArtGallery
  cards={cardList}
  size="small"
  useProceduralArt={true}
  onCardClick={(cardId) => handleSelect(cardId)}
/>
```

### Show Card Back

```tsx
<CardArt
  cardName="Mystery Card"
  showBack={true}
  size="normal"
/>
```

### Disable Procedural Art (use legacy)

```tsx
<CardArt
  cardName="Card Name"
  useProceduralArt={false}
  imageUri="/path/to/image.jpg"
/>
```

## Troubleshooting

### Artwork not displaying
1. Check browser console for errors
2. Ensure `useProceduralArt={true}` is set
3. Verify cache is initialized
4. Try clearing cache: `await artworkCache.clear()`

### Slow performance
1. Pre-generate frequently used cards
2. Check cache stats: `await artworkCache.getStats()`
3. Reduce number of simultaneous generations

### Cache issues
1. Clear cache: `await artworkCache.clear()`
2. Check IndexedDB quota
3. Clear browser storage

## Testing

### Run Demo
```bash
npm run dev
# Navigate to http://localhost:9002/artwork-demo
```

### Run Validation
```bash
./scripts/validate-unit-4.sh
```

## Documentation

- Full documentation: `/ARTWORK_GENERATION_README.md`
- Implementation details: `/UNIT_4_IMPLEMENTATION_SUMMARY.md`
- Demo page: `/artwork-demo`

## Support

For issues or questions:
1. Check this quick reference
2. Read full documentation
3. Review demo page
4. Check source code comments
5. Open an issue on GitHub
