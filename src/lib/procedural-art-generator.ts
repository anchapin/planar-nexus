/**
 * @fileOverview Procedural artwork generator for card art
 *
 * This module generates unique, legal-safe SVG artwork for cards based on their properties.
 * Uses deterministic algorithms to create consistent artwork for the same card.
 */

export interface ArtworkConfig {
  // Card properties
  cardName: string;
  cardId: string;
  colors: string[];
  typeLine: string;
  cmc: number;

  // Visual style
  style?: 'fantasy' | 'sci-fi' | 'abstract' | 'geometric';
  complexity?: 'simple' | 'medium' | 'complex';
  mood?: 'peaceful' | 'energetic' | 'mysterious' | 'aggressive';

  // Dimensions
  width?: number;
  height?: number;
}

export interface GeneratedArtwork {
  svg: string;
  cacheKey: string;
}

// Color palettes for different moods
const COLOR_PALETTES = {
  peaceful: [
    ['#A7C7E7', '#E8F4F8', '#B4E7CE', '#D4E2D4', '#C9D4D5'], // Blues and greens
    ['#E6B89C', '#F5E6D3', '#E8D5C4', '#D4B5A0', '#C9A885'], // Warm pastels
  ],
  energetic: [
    ['#FF6B6B', '#FFE66D', '#4ECDC4', '#95E1D3', '#F38181'], // Bright and vibrant
    ['#FF8C42', '#FF3C83', '#FFD93D', '#6BCB77', '#4D96FF'], // High contrast
  ],
  mysterious: [
    ['#2C3E50', '#34495E', '#1ABC9C', '#16A085', '#3498DB'], // Deep blues and teals
    ['#4A235A', '#5B2C6F', '#7D3C98', '#8E44AD', '#6C3483'], // Purples
  ],
  aggressive: [
    ['#C0392B', '#E74C3C', '#F39C12', '#D35400', '#922B21'], // Reds and oranges
    ['#8B0000', '#DC143C', '#FF4500', '#FF6347', '#B22222'], // Intense reds
  ],
};

// Shape generators
function generateSeededRandom(seed: string): () => number {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) {
    hash = ((hash << 5) - hash) + seed.charCodeAt(i);
    hash = hash & hash;
  }

  return () => {
    const x = Math.sin(hash++) * 10000;
    return x - Math.floor(x);
  };
}

function generateGradient(
  colors: string[],
  width: number,
  height: number,
  angle: number = 45
): string {
  const gradientColors = colors.join(', ');
  return `linear-gradient(${angle}deg, ${gradientColors})`;
}

function generateBackground(
  colors: string[],
  width: number,
  height: number,
  random: () => number,
  complexity: string
): string {
  const bgColor = colors[0];
  const secondaryColor = colors[1] || colors[0];

  // Create SVG gradient
  const x1 = random() * width;
  const y1 = random() * height;
  const x2 = random() * width;
  const y2 = random() * height;

  let bgContent = `
    <defs>
      <linearGradient id="bg-gradient" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">
        <stop offset="0%" style="stop-color:${bgColor};stop-opacity:1" />
        <stop offset="100%" style="stop-color:${secondaryColor};stop-opacity:1" />
      </linearGradient>
    `;

  // Add noise texture for complexity
  if (complexity === 'medium' || complexity === 'complex') {
    bgContent += `
      <filter id="noise">
        <feTurbulence type="fractalNoise" baseFrequency="0.8" numOctaves="4" />
        <feColorMatrix type="saturate" values="0" />
        <feComponentTransfer>
          <feFuncA type="linear" slope="0.05" />
        </feComponentTransfer>
      </filter>
    `;
  }

  bgContent += `</defs>`;

  return `
    <rect width="100%" height="100%" fill="url(#bg-gradient)" />
    ${complexity === 'medium' || complexity === 'complex'
      ? `<rect width="100%" height="100%" filter="url(#noise)" opacity="0.5" />`
      : ''}
  `;
}

function generateShapes(
  colors: string[],
  width: number,
  height: number,
  random: () => number,
  style: string,
  complexity: string
): string {
  const shapeCount =
    complexity === 'simple' ? 3 : complexity === 'medium' ? 6 : 10;
  let shapes = '';

  for (let i = 0; i < shapeCount; i++) {
    const color = colors[Math.floor(random() * colors.length)];
    const opacity = 0.1 + random() * 0.4;
    const x = random() * width;
    const y = random() * height;

    switch (style) {
      case 'fantasy': {
        // Organic, flowing shapes
        const r1 = 20 + random() * 60;
        const r2 = 20 + random() * 60;
        shapes += `
          <ellipse
            cx="${x}" cy="${y}" rx="${r1}" ry="${r2}"
            fill="${color}" opacity="${opacity}"
            transform="rotate(${random() * 360}, ${x}, ${y})"
          />
        `;
        break;
      }

      case 'sci-fi': {
        // Geometric, angular shapes
        const size = 30 + random() * 70;
        const rotation = random() * 360;
        shapes += `
          <polygon
            points="${x},${y - size/2} ${x + size/2},${y} ${x},${y + size/2} ${x - size/2},${y}"
            fill="${color}" opacity="${opacity}"
            transform="rotate(${rotation}, ${x}, ${y})"
          />
        `;
        break;
      }

      case 'abstract': {
        // Random lines and curves
        const pathLength = 50 + random() * 100;
        shapes += `
          <path
            d="M ${x} ${y}
               Q ${x + random() * 50} ${y + random() * 50}
                 ${x + random() * pathLength} ${y + random() * pathLength}
               T ${x + random() * pathLength * 2} ${y + random() * pathLength * 2}"
            stroke="${color}" stroke-width="${1 + random() * 3}"
            fill="none" opacity="${opacity}"
          />
        `;
        break;
      }

      case 'geometric': {
        // Perfect shapes with rotation
        const sides = 3 + Math.floor(random() * 5);
        const radius = 30 + random() * 60;
        const points = Array.from({ length: sides }, (_, idx) => {
          const angle = (idx / sides) * 2 * Math.PI + (random() * 0.5);
          return `${x + Math.cos(angle) * radius},${y + Math.sin(angle) * radius}`;
        }).join(' ');
        shapes += `
          <polygon
            points="${points}"
            fill="${color}" opacity="${opacity}"
            transform="rotate(${random() * 360}, ${x}, ${y})"
          />
        `;
        break;
      }
    }
  }

  return shapes;
}

function generateParticles(
  colors: string[],
  width: number,
  height: number,
  random: () => number,
  complexity: string
): string {
  if (complexity === 'simple') return '';

  const particleCount = complexity === 'medium' ? 20 : 50;
  let particles = '';

  for (let i = 0; i < particleCount; i++) {
    const color = colors[Math.floor(random() * colors.length)];
    const size = 1 + random() * 3;
    const x = random() * width;
    const y = random() * height;

    particles += `
      <circle
        cx="${x}" cy="${y}" r="${size}"
        fill="${color}" opacity="${0.3 + random() * 0.4}"
      />
    `;
  }

  return particles;
}

function generateSymbol(
  colors: string[],
  width: number,
  height: number,
  random: () => number,
  typeLine: string
): string {
  const centerX = width / 2;
  const centerY = height / 2;
  const size = Math.min(width, height) * 0.3;
  const color = colors[colors.length - 1];

  // Determine symbol type based on card type
  let symbol: string;
  if (typeLine.toLowerCase().includes('creature')) {
    // Diamond shape for creatures
    symbol = `
      <polygon
        points="${centerX},${centerY - size/2}
                ${centerX + size/2},${centerY}
                ${centerX},${centerY + size/2}
                ${centerX - size/2},${centerY}"
        fill="${color}" opacity="0.8"
      />
    `;
  } else if (typeLine.toLowerCase().includes('instant') || typeLine.toLowerCase().includes('sorcery')) {
    // Lightning bolt for instants/sorceries
    symbol = `
      <polygon
        points="${centerX - size/6},${centerY - size/2}
                ${centerX + size/6},${centerY - size/2}
                ${centerX - size/6},${centerY}
                ${centerX + size/6},${centerY}
                ${centerX - size/12},${centerY + size/2}
                ${centerX + size/12},${centerY + size/2}"
        fill="${color}" opacity="0.8"
      />
    `;
  } else if (typeLine.toLowerCase().includes('enchantment')) {
    // Star shape for enchantments
    const points = Array.from({ length: 5 }, (_, idx) => {
      const angle = (idx / 5) * 2 * Math.PI - Math.PI / 2;
      return `${centerX + Math.cos(angle) * size/2},${centerY + Math.sin(angle) * size/2}`;
    }).join(' ');
    symbol = `
      <polygon
        points="${points}"
        fill="${color}" opacity="0.8"
      />
    `;
  } else if (typeLine.toLowerCase().includes('artifact')) {
    // Gear shape for artifacts
    symbol = `
      <circle
        cx="${centerX}" cy="${centerY}" r="${size/3}"
        fill="${color}" opacity="0.8"
      />
      <circle
        cx="${centerX}" cy="${centerY}" r="${size/6}"
        fill="${color || '#ffffff'}" opacity="0.8"
      />
    `;
  } else {
    // Default circle
    symbol = `
      <circle
        cx="${centerX}" cy="${centerY}" r="${size/2}"
        fill="${color}" opacity="0.8"
      />
    `;
  }

  return symbol;
}

/**
 * Generate procedural artwork for a card
 */
export function generateArtwork(config: ArtworkConfig): GeneratedArtwork {
  const {
    cardName,
    cardId,
    colors,
    typeLine,
    cmc,
    style = 'fantasy',
    complexity = 'medium',
    mood = 'peaceful',
    width = 244,
    height = 340,
  } = config;

  // Generate cache key based on card properties
  const cacheKey = `${cardId}-${style}-${complexity}-${mood}-${width}x${height}`;

  // Initialize random number generator with card-specific seed
  const random = generateSeededRandom(cardId);

  // Select color palette based on mood and card colors
  const moodPalettes = COLOR_PALETTES[mood] || COLOR_PALETTES.peaceful;
  const selectedPalette = moodPalettes[Math.floor(random() * moodPalettes.length)];

  // Mix with card colors if available
  const finalColors = [...selectedPalette];
  if (colors.length > 0) {
    // Add card colors to palette
    colors.forEach(color => {
      if (!finalColors.includes(color)) {
        finalColors.unshift(color);
      }
    });
    // Limit to 5 colors
    finalColors.length = Math.min(finalColors.length, 5);
  }

  // Generate SVG components
  const background = generateBackground(finalColors, width, height, random, complexity);
  const shapes = generateShapes(finalColors, width, height, random, style, complexity);
  const particles = generateParticles(finalColors, width, height, random, complexity);
  const symbol = generateSymbol(finalColors, width, height, random, typeLine);

  // Assemble SVG
  const svg = `
    <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">
      ${background}
      ${shapes}
      ${particles}
      ${symbol}
    </svg>
  `.trim();

  return {
    svg,
    cacheKey,
  };
}

/**
 * Convert SVG to data URL for use as image source
 */
export function svgToDataUrl(svg: string): string {
  const encodedSvg = encodeURIComponent(svg);
  return `data:image/svg+xml;charset=utf-8,${encodedSvg}`;
}

/**
 * Cache for generated artwork
 */
const artworkCache = new Map<string, string>();

/**
 * Get or generate artwork with caching
 */
export function getCachedArtwork(config: ArtworkConfig): string {
  const { cacheKey } = generateArtwork(config);

  if (!artworkCache.has(cacheKey)) {
    const { svg } = generateArtwork(config);
    artworkCache.set(cacheKey, svgToDataUrl(svg));
  }

  return artworkCache.get(cacheKey)!;
}

/**
 * Clear artwork cache
 */
export function clearArtworkCache(): void {
  artworkCache.clear();
}

/**
 * Pre-generate artwork for multiple cards
 */
export function pregenerateArtwork(
  configs: ArtworkConfig[],
  callback?: (progress: number, total: number) => void
): void {
  configs.forEach((config, index) => {
    getCachedArtwork(config);
    callback?.(index + 1, configs.length);
  });
}

/**
 * Determine artwork style based on card type
 */
export function determineStyleFromTypeLine(typeLine: string): ArtworkConfig['style'] {
  const lowerType = typeLine.toLowerCase();
  if (lowerType.includes('artifact') || lowerType.includes('equipment')) {
    return 'sci-fi';
  } else if (lowerType.includes('enchantment') || lowerType.includes('aura')) {
    return 'fantasy';
  } else if (lowerType.includes('instant') || lowerType.includes('sorcery')) {
    return 'abstract';
  }
  return 'fantasy';
}

/**
 * Determine artwork mood based on card colors and CMC
 */
export function determineMoodFromCard(colors: string[], cmc: number): ArtworkConfig['mood'] {
  // High CMC + red/black = aggressive
  if (cmc > 4 && (colors.includes('R') || colors.includes('B'))) {
    return 'aggressive';
  }
  // Blue/black = mysterious
  if (colors.includes('U') || colors.includes('B')) {
    return 'mysterious';
  }
  // Red/green = energetic
  if (colors.includes('R') || colors.includes('G')) {
    return 'energetic';
  }
  // Default to peaceful
  return 'peaceful';
}

/**
 * Determine complexity based on CMC
 */
export function determineComplexityFromCMC(cmc: number): ArtworkConfig['complexity'] {
  if (cmc <= 2) return 'simple';
  if (cmc <= 4) return 'medium';
  return 'complex';
}
