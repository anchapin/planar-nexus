/**
 * Procedural Artwork Generation System
 *
 * Generates legal-safe SVG-based card artwork using procedural algorithms.
 * This system creates unique, consistent artwork for each card based on:
 * - Card type (creature, spell, artifact, land, etc.)
 * - Color identity
 * - Card name (for deterministic generation)
 * - Mana cost/complexity
 *
 * All artwork is procedurally generated on the client side and cached.
 */

// Card type categories for artwork styling
export type CardTypeCategory =
  | 'creature'
  | 'instant'
  | 'sorcery'
  | 'artifact'
  | 'enchantment'
  | 'land'
  | 'planeswalker'
  | 'battle';

// Color palette for procedural generation
const COLOR_PALETTES = {
  W: {
    primary: '#F8F9FA',
    secondary: '#E9ECEF',
    accent: '#495057',
    gradient: ['#DEE2E6', '#F8F9FA'],
  },
  U: {
    primary: '#0A84FF',
    secondary: '#64D2FF',
    accent: '#0056D6',
    gradient: ['#007AFF', '#64D2FF'],
  },
  B: {
    primary: '#636366',
    secondary: '#8E8E93',
    accent: '#3A3A3C',
    gradient: ['#2C2C2E', '#636366'],
  },
  R: {
    primary: '#FF453A',
    secondary: '#FF6961',
    accent: '#C42B1F',
    gradient: ['#FF3B30', '#FF6961'],
  },
  G: {
    primary: '#30D158',
    secondary: '#63E6BE',
    accent: '#248A3D',
    gradient: ['#32D74B', '#63E6BE'],
  },
  colorless: {
    primary: '#8E8E93',
    secondary: '#C7C7CC',
    accent: '#636366',
    gradient: ['#AEAEB2', '#D1D1D6'],
  },
  multicolor: {
    primary: '#BF5AF2',
    secondary: '#DA70D6',
    accent: '#9933CC',
    gradient: ['#AF52DE', '#DA70D6'],
  },
} as const;

// Artwork style presets for different card types
const ARTWORK_STYLES: Record<CardTypeCategory, StylePreset> = {
  creature: {
    backgroundType: 'portrait',
    patternDensity: 'high',
    elementCount: 'many',
    organic: true,
    symmetry: 'none',
  },
  instant: {
    backgroundType: 'action',
    patternDensity: 'medium',
    elementCount: 'moderate',
    organic: false,
    symmetry: 'radial',
  },
  sorcery: {
    backgroundType: 'scene',
    patternDensity: 'high',
    elementCount: 'many',
    organic: true,
    symmetry: 'none',
  },
  artifact: {
    backgroundType: 'geometric',
    patternDensity: 'very-high',
    elementCount: 'few',
    organic: false,
    symmetry: 'rotational',
  },
  enchantment: {
    backgroundType: 'ethereal',
    patternDensity: 'medium',
    elementCount: 'moderate',
    organic: true,
    symmetry: 'radial',
  },
  land: {
    backgroundType: 'landscape',
    patternDensity: 'low',
    elementCount: 'few',
    organic: true,
    symmetry: 'none',
  },
  planeswalker: {
    backgroundType: 'portrait',
    patternDensity: 'high',
    elementCount: 'many',
    organic: true,
    symmetry: 'bilateral',
  },
  battle: {
    backgroundType: 'action',
    patternDensity: 'very-high',
    elementCount: 'many',
    organic: false,
    symmetry: 'none',
  },
} as const;

interface StylePreset {
  backgroundType: 'portrait' | 'landscape' | 'geometric' | 'action' | 'scene' | 'ethereal';
  patternDensity: 'low' | 'medium' | 'high' | 'very-high';
  elementCount: 'few' | 'moderate' | 'many';
  organic: boolean;
  symmetry: 'none' | 'radial' | 'rotational' | 'bilateral';
}

// Seeded random number generator for deterministic artwork
class SeededRandom {
  private seed: number;

  constructor(seed: string) {
    this.seed = this.hashString(seed);
  }

  private hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  next(): number {
    this.seed = (this.seed * 9301 + 49297) % 233280;
    return this.seed / 233280;
  }

  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  nextFloat(min: number, max: number): number {
    return this.next() * (max - min) + min;
  }

  shuffle<T>(array: T[]): T[] {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  pick<T>(array: T[]): T {
    return array[Math.floor(this.next() * array.length)];
  }
}

// Generate deterministic SVG artwork for a card
export interface ProceduralArtworkConfig {
  cardName: string;
  typeLine: string;
  colors: string[];
  cmc: number;
  width?: number;
  height?: number;
  variant?: number;
}

/**
 * Generate procedural SVG artwork for a card
 */
export function generateProceduralArtwork(config: ProceduralArtworkConfig): string {
  const { cardName, typeLine, colors, cmc, width = 480, height = 680, variant = 0 } = config;

  // Create seeded random for deterministic generation
  const rng = new SeededRandom(`${cardName}-${variant}`);

  // Determine card type category
  const cardType = determineCardTypeCategory(typeLine);

  // Get color palette
  const palette = getColorPalette(colors);

  // Get artwork style
  const style = ARTWORK_STYLES[cardType];

  // Generate background
  const background = generateBackground(rng, style, palette, width, height);

  // Generate decorative elements
  const elements = generateDecorativeElements(rng, style, palette, width, height, cmc);

  // Generate pattern overlay
  const pattern = generatePatternOverlay(rng, style, palette, width, height);

  // Assemble SVG
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
      <defs>
        ${generateGradients(palette, cardType)}
        ${generateFilters()}
      </defs>
      ${background}
      ${elements}
      ${pattern}
    </svg>
  `;

  return svg;
}

/**
 * Determine card type category from type line
 */
function determineCardTypeCategory(typeLine: string): CardTypeCategory {
  const lower = typeLine.toLowerCase();

  if (lower.includes('creature')) return 'creature';
  if (lower.includes('instant')) return 'instant';
  if (lower.includes('sorcery')) return 'sorcery';
  if (lower.includes('artifact')) return 'artifact';
  if (lower.includes('enchantment')) return 'enchantment';
  if (lower.includes('land')) return 'land';
  if (lower.includes('planeswalker')) return 'planeswalker';
  if (lower.includes('battle')) return 'battle';

  // Default to instant for unknown types
  return 'instant';
}

/**
 * Get color palette based on color identity
 */
function getColorPalette(colors: string[]): typeof COLOR_PALETTES[keyof typeof COLOR_PALETTES] {
  if (colors.length === 0) return COLOR_PALETTES.colorless;
  if (colors.length === 1) {
    const color = colors[0].toUpperCase();
    return COLOR_PALETTES[color as keyof typeof COLOR_PALETTES] || COLOR_PALETTES.colorless;
  }
  return COLOR_PALETTES.multicolor;
}

/**
 * Generate background layer
 */
function generateBackground(
  rng: SeededRandom,
  style: StylePreset,
  palette: typeof COLOR_PALETTES[keyof typeof COLOR_PALETTES],
  width: number,
  height: number
): string {
  const gradientId = `bg-gradient-${rng.nextInt(0, 100)}`;

  switch (style.backgroundType) {
    case 'portrait':
      return `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})" opacity="0.9"/>
              <ellipse cx="${width * 0.5}" cy="${height * 0.4}" rx="${width * 0.4}" ry="${height * 0.3}"
                      fill="${palette.primary}" opacity="0.3" filter="url(#blur)"/>`;

    case 'landscape':
      return `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})" opacity="0.9"/>
              <path d="M0 ${height * 0.6} Q ${width * 0.25} ${height * 0.4} ${width * 0.5} ${height * 0.55}
                      T ${width} ${height * 0.5} V ${height} H 0 Z"
                    fill="${palette.primary}" opacity="0.25"/>`;

    case 'geometric':
      const shapes = [];
      const shapeCount = rng.nextInt(3, 6);
      for (let i = 0; i < shapeCount; i++) {
        const x = rng.nextFloat(0, width);
        const y = rng.nextFloat(0, height);
        const size = rng.nextFloat(50, 150);
        shapes.push(`
          <rect x="${x}" y="${y}" width="${size}" height="${size}"
                fill="${palette.secondary}" opacity="0.2"
                transform="rotate(${rng.nextInt(0, 360)} ${x + size/2} ${y + size/2})"/>
        `);
      }
      return `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})" opacity="0.9"/>
              ${shapes.join('')}`;

    case 'action':
      return `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})" opacity="0.9"/>
              <circle cx="${width * 0.5}" cy="${height * 0.5}" r="${width * 0.3}"
                      fill="${palette.primary}" opacity="0.2" filter="url(#blur)"/>`;

    case 'scene':
      return `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})" opacity="0.9"/>
              <ellipse cx="${width * 0.3}" cy="${height * 0.7}" rx="${width * 0.4}" ry="${height * 0.2}"
                      fill="${palette.primary}" opacity="0.15"/>
              <ellipse cx="${width * 0.7}" cy="${height * 0.75}" rx="${width * 0.3}" ry="${height * 0.15}"
                      fill="${palette.primary}" opacity="0.1"/>`;

    case 'ethereal':
      return `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})" opacity="0.9"/>
              <circle cx="${width * 0.5}" cy="${height * 0.5}" r="${width * 0.4}"
                      fill="none" stroke="${palette.secondary}" stroke-width="2" opacity="0.3"/>
              <circle cx="${width * 0.5}" cy="${height * 0.5}" r="${width * 0.3}"
                      fill="none" stroke="${palette.secondary}" stroke-width="1.5" opacity="0.2"/>`;

    default:
      return `<rect x="0" y="0" width="${width}" height="${height}" fill="url(#${gradientId})" opacity="0.9"/>`;
  }
}

/**
 * Generate decorative elements
 */
function generateDecorativeElements(
  rng: SeededRandom,
  style: StylePreset,
  palette: typeof COLOR_PALETTES[keyof typeof COLOR_PALETTES],
  width: number,
  height: number,
  cmc: number
): string {
  const elements: string[] = [];
  const count = getElementCount(style.elementCount) + Math.floor(cmc / 2);

  for (let i = 0; i < count; i++) {
    const elementType = rng.pick(['circle', 'rect', 'triangle', 'line', 'arc']);
    const x = rng.nextFloat(width * 0.1, width * 0.9);
    const y = rng.nextFloat(height * 0.1, height * 0.9);
    const size = rng.nextFloat(20, 80);
    const opacity = rng.nextFloat(0.1, 0.4);

    elements.push(generateElement(elementType, x, y, size, opacity, palette, style.organic, rng));
  }

  return elements.join('');
}

/**
 * Generate individual decorative element
 */
function generateElement(
  type: string,
  x: number,
  y: number,
  size: number,
  opacity: number,
  palette: typeof COLOR_PALETTES[keyof typeof COLOR_PALETTES],
  organic: boolean,
  rng: SeededRandom
): string {
  const color = rng.pick([palette.primary, palette.secondary, palette.accent]);

  switch (type) {
    case 'circle':
      return `<circle cx="${x}" cy="${y}" r="${size}" fill="${color}" opacity="${opacity}"/>`;

    case 'rect':
      const rotation = organic ? rng.nextInt(0, 360) : 0;
      return `<rect x="${x - size/2}" y="${y - size/2}" width="${size}" height="${size}"
                     fill="${color}" opacity="${opacity}" transform="rotate(${rotation} ${x} ${y})"/>`;

    case 'triangle':
      const h = size * (Math.sqrt(3) / 2);
      return `<polygon points="${x},${y - h/2} ${x - size/2},${y + h/2} ${x + size/2},${y + h/2}"
                     fill="${color}" opacity="${opacity}"/>`;

    case 'line':
      const angle = rng.nextInt(0, 360);
      const length = size * 2;
      const endX = x + Math.cos(angle * Math.PI / 180) * length;
      const endY = y + Math.sin(angle * Math.PI / 180) * length;
      return `<line x1="${x}" y1="${y}" x2="${endX}" y2="${endY}"
                    stroke="${color}" stroke-width="${size / 10}" opacity="${opacity}"/>`;

    case 'arc':
      const arcRadius = size;
      const arcStart = rng.nextInt(0, 360);
      const arcEnd = arcStart + rng.nextInt(45, 180);
      return `<path d="M ${x + arcRadius * Math.cos(arcStart * Math.PI / 180)} ${y + arcRadius * Math.sin(arcStart * Math.PI / 180)}
                     A ${arcRadius} ${arcRadius} 0 0 1 ${x + arcRadius * Math.cos(arcEnd * Math.PI / 180)} ${y + arcRadius * Math.sin(arcEnd * Math.PI / 180)}"
                    fill="none" stroke="${color}" stroke-width="${size / 8}" opacity="${opacity}"/>`;

    default:
      return '';
  }
}

/**
 * Generate pattern overlay
 */
function generatePatternOverlay(
  rng: SeededRandom,
  style: StylePreset,
  palette: typeof COLOR_PALETTES[keyof typeof COLOR_PALETTES],
  width: number,
  height: number
): string {
  const density = getPatternDensity(style.patternDensity);
  const elements: string[] = [];

  for (let i = 0; i < density; i++) {
    const x = rng.nextFloat(0, width);
    const y = rng.nextFloat(0, height);
    const size = rng.nextFloat(5, 15);

    elements.push(`<circle cx="${x}" cy="${y}" r="${size}" fill="${palette.accent}" opacity="0.1"/>`);
  }

  return `<g filter="url(#blur)">${elements.join('')}</g>`;
}

/**
 * Generate SVG gradients
 */
function generateGradients(
  palette: typeof COLOR_PALETTES[keyof typeof COLOR_PALETTES],
  cardType: CardTypeCategory
): string {
  const id = `bg-gradient-${cardType}`;
  return `
    <linearGradient id="${id}" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${palette.gradient[0]};stop-opacity:1" />
      <stop offset="100%" style="stop-color:${palette.gradient[1]};stop-opacity:1" />
    </linearGradient>
  `;
}

/**
 * Generate SVG filters
 */
function generateFilters(): string {
  return `
    <filter id="blur" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="3" />
    </filter>
    <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur" />
      <feMerge>
        <feMergeNode in="blur" />
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  `;
}

/**
 * Get element count based on style preset
 */
function getElementCount(count: StylePreset['elementCount']): number {
  switch (count) {
    case 'few':
      return 3;
    case 'moderate':
      return 6;
    case 'many':
      return 12;
    default:
      return 6;
  }
}

/**
 * Get pattern density based on style preset
 */
function getPatternDensity(density: StylePreset['patternDensity']): number {
  switch (density) {
    case 'low':
      return 10;
    case 'medium':
      return 25;
    case 'high':
      return 50;
    case 'very-high':
      return 80;
    default:
      return 25;
  }
}

/**
 * Convert SVG to data URI for use in img tags
 */
export function svgToDataUri(svg: string): string {
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
  return `data:image/svg+xml;charset=utf-8,${encoded}`;
}

/**
 * Generate artwork and return as data URI
 */
export function generateArtworkDataUri(config: ProceduralArtworkConfig): string {
  const svg = generateProceduralArtwork(config);
  return svgToDataUri(svg);
}

/**
 * Generate multiple variants for a card
 */
export function generateArtworkVariants(
  config: Omit<ProceduralArtworkConfig, 'variant'>,
  count: number = 3
): string[] {
  return Array.from({ length: count }, (_, i) =>
    generateArtworkDataUri({ ...config, variant: i })
  );
}
