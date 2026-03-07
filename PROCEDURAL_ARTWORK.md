# Procedural Artwork Generation System

## Overview

This system generates unique, legal-safe SVG artwork for cards using deterministic algorithms. It replaces traditional card images with procedurally generated artwork based on card properties.

## Features

- **100% Client-Side**: All artwork generation happens in the browser, no server required
- **Deterministic**: Same card = same artwork every time
- **Caching**: Generated artwork is cached for performance
- **Legal-Safe**: No copyright concerns - all artwork is procedurally generated
- **Customizable**: Multiple styles, moods, and complexity levels
- **Responsive**: Works at any size

## How It Works

### Artwork Generation

The system generates artwork based on the following card properties:

1. **Card Colors**: Influence the color palette and mood
   - Red/Black: Aggressive mood
   - Blue/Black: Mysterious mood
   - Red/Green: Energetic mood
   - White/Green: Peaceful mood

2. **Converted Mana Cost (CMC)**: Determines complexity
   - 0-2: Simple (fewer shapes, cleaner design)
   - 3-4: Medium (balanced design)
   - 5+: Complex (more details, layered elements)

3. **Card Type**: Influences artistic style
   - Artifact/Equipment: Sci-fi style (geometric, angular shapes)
   - Enchantment: Fantasy style (organic, flowing shapes)
   - Instant/Sorcery: Abstract style (lines, curves)
   - Creature: Fantasy style (organic shapes with central symbol)

4. **Card ID**: Used as a seed for deterministic generation

### Artwork Components

Generated artwork includes:

1. **Background**: Gradient with optional noise texture
2. **Shapes**: Multiple layered shapes based on style
3. **Particles**: Small decorative elements (medium/complex only)
4. **Central Symbol**: Type-specific emblem in the center

## Usage

### Basic Usage

#### Using CardArt Component

```tsx
import { CardArt } from '@/components/card-art';

<CardArt
  cardName="Crimson Dragon"
  scryfallCard={{
    id: 'card-001',
    name: 'Crimson Dragon',
    color_identity: ['R'],
    type_line: 'Legendary Creature — Dragon',
    cmc: 5,
    colors: ['R'],
  }}
  useProcedural={true}
  size="normal"
/>
```

#### Using ProceduralCard Component (Simplified)

```tsx
import { ProceduralCard } from '@/components/procedural-card';

<ProceduralCard
  cardName="Crimson Dragon"
  cardId="card-001"
  colors={['R']}
  typeLine="Legendary Creature — Dragon"
  cmc={5}
  size="normal"
/>
```

### Using the Hook Directly

```tsx
import { useAutoStyledArtwork } from '@/hooks/use-procedural-artwork';

function MyComponent() {
  const { artworkUrl } = useAutoStyledArtwork({
    cardName: 'Crimson Dragon',
    cardId: 'card-001',
    colors: ['R'],
    typeLine: 'Legendary Creature — Dragon',
    cmc: 5,
    width: 244,
    height: 340,
  });

  return <img src={artworkUrl} alt="Crimson Dragon" />;
}
```

### Custom Configuration

```tsx
import { generateArtwork, svgToDataUrl } from '@/lib/procedural-art-generator';

const { svg } = generateArtwork({
  cardName: 'Crimson Dragon',
  cardId: 'card-001',
  colors: ['R'],
  typeLine: 'Legendary Creature — Dragon',
  cmc: 5,
  style: 'fantasy',
  complexity: 'complex',
  mood: 'aggressive',
  width: 244,
  height: 340,
});

const dataUrl = svgToDataUrl(svg);
```

## Configuration

### Global Configuration

```tsx
import {
  getProceduralArtworkConfig,
  updateProceduralArtworkConfig,
  setProceduralArtworkEnabled,
} from '@/lib/procedural-art-config';

// Get current config
const config = getProceduralArtworkConfig();

// Update specific settings
updateProceduralArtworkConfig({
  enabled: true,
  defaultStyle: 'fantasy',
  defaultComplexity: 'medium',
});

// Enable/disable globally
setProceduralArtworkEnabled(true);
```

### Styles

- **fantasy**: Organic, flowing shapes, natural patterns
- **sci-fi**: Geometric, angular shapes, tech-inspired
- **abstract**: Lines, curves, artistic patterns
- **geometric**: Perfect shapes, mathematical patterns

### Moods

- **peaceful**: Blues, greens, calm colors
- **energetic**: Bright, vibrant colors, high contrast
- **mysterious**: Deep blues, teals, purples
- **aggressive**: Reds, oranges, intense colors

### Complexity

- **simple**: Fewer shapes, cleaner design
- **medium**: Balanced design with moderate detail
- **complex**: Many shapes, layered elements, high detail

## Performance

### Caching

Artwork is automatically cached using the cache key:

```
{cardId}-{style}-{complexity}-{mood}-{width}x{height}
```

### Pre-generating Artwork

```tsx
import { pregenerateArtwork } from '@/lib/procedural-art-generator';

// Pre-generate artwork for multiple cards
pregenerateArtwork(
  cardConfigs,
  (progress, total) => {
    console.log(`Progress: ${progress}/${total}`);
  }
);
```

### Clearing Cache

```tsx
import { clearArtworkCache } from '@/lib/procedural-art-generator';

clearArtworkCache();
```

## Integration with Existing Components

### CardArt Component

The `CardArt` component now supports procedural artwork:

```tsx
<CardArt
  cardName={card.name}
  scryfallCard={card}
  useProcedural={true}  // Enable procedural artwork
  size="normal"
/>
```

### Image Resolver

Use the procedural artwork resolver:

```tsx
import {
  getProceduralArtworkUrl,
  getArtworkWithFallback,
  shouldUseProceduralArtwork,
} from '@/lib/card-image-resolver-procedural';

// Get procedural artwork URL
const url = getProceduralArtworkUrl(card, 'normal');

// Get with fallback to original images
const url = getArtworkWithFallback(card, 'normal', true);

// Check if should use procedural
if (shouldUseProceduralArtwork(card)) {
  // Use procedural artwork
}
```

## Demo Page

Visit `/procedural-art-demo` to see the system in action with various card types and configurations.

## Technical Details

### SVG Generation

Artwork is generated as SVG with:

1. **Gradients**: Linear gradients for backgrounds
2. **Filters**: Noise filters for texture
3. **Shapes**: Multiple geometric shapes with transforms
4. **Particles**: Small circles for detail
5. **Symbols**: Type-specific central emblems

### Seeded Random

The system uses a seeded random number generator to ensure deterministic output:

```typescript
const random = generateSeededRandom(cardId);
const value = random(); // Always the same for the same cardId
```

### Data URL Conversion

SVG is converted to data URL for use as image source:

```typescript
const dataUrl = svgToDataUrl(svg);
// Result: "data:image/svg+xml;charset=utf-8,..."
```

## Legal Considerations

This system is designed to be completely legal-safe:

- No external assets or images
- No copyright infringement
- All artwork is procedurally generated
- No trademark issues
- Can be used for commercial projects

## Future Enhancements

Potential improvements:

1. **More Styles**: Additional artistic styles
2. **Animation**: Animated SVG elements
3. **Export**: PNG/JPG export options
4. **Custom Symbols**: User-defined symbols
5. **AI Integration**: Hybrid procedural + AI generation
6. **Templates**: User-defined artwork templates

## Troubleshooting

### Artwork Not Appearing

- Check that `useProcedural` prop is set to `true`
- Verify card properties (colors, typeLine, cmc) are provided
- Check browser console for errors

### Artwork Looks Different Each Time

- Ensure card ID is consistent
- Check that cache is not being cleared
- Verify cache key is deterministic

### Performance Issues

- Enable caching (default: enabled)
- Pre-generate artwork for commonly used cards
- Reduce complexity for faster generation
- Use smaller sizes when possible

## Contributing

When modifying the procedural artwork system:

1. Test with various card types
2. Verify determinism (same card = same artwork)
3. Check performance with large card sets
4. Update this documentation
5. Add examples to the demo page

## Related Files

- `/src/lib/procedural-art-generator.ts` - Core generation logic
- `/src/lib/procedural-art-config.ts` - Configuration management
- `/src/hooks/use-procedural-artwork.ts` - React hook
- `/src/lib/card-image-resolver-procedural.ts` - Image resolver integration
- `/src/components/card-art.tsx` - Card display component
- `/src/app/(app)/procedural-art-demo/page.tsx` - Demo page
