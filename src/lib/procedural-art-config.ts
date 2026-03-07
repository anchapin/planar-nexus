/**
 * @fileOverview Configuration for procedural artwork system
 *
 * Global settings for the procedural artwork generation system.
 */

export interface ProceduralArtworkConfig {
  /** Whether to use procedural artwork by default */
  enabled: boolean;

  /** Default style for procedural artwork */
  defaultStyle: 'fantasy' | 'sci-fi' | 'abstract' | 'geometric';

  /** Default complexity for procedural artwork */
  defaultComplexity: 'simple' | 'medium' | 'complex';

  /** Default mood for procedural artwork */
  defaultMood: 'peaceful' | 'energetic' | 'mysterious' | 'aggressive';

  /** Whether to enable artwork caching */
  enableCaching: boolean;

  /** Maximum number of cached artworks */
  maxCacheSize: number;
}

/**
 * Default configuration
 */
export const DEFAULT_CONFIG: ProceduralArtworkConfig = {
  enabled: true,
  defaultStyle: 'fantasy',
  defaultComplexity: 'medium',
  defaultMood: 'peaceful',
  enableCaching: true,
  maxCacheSize: 1000,
};

/**
 * Current configuration (can be modified at runtime)
 */
let currentConfig: ProceduralArtworkConfig = { ...DEFAULT_CONFIG };

/**
 * Get current configuration
 */
export function getProceduralArtworkConfig(): ProceduralArtworkConfig {
  return { ...currentConfig };
}

/**
 * Update configuration
 */
export function updateProceduralArtworkConfig(updates: Partial<ProceduralArtworkConfig>): void {
  currentConfig = { ...currentConfig, ...updates };
}

/**
 * Reset configuration to defaults
 */
export function resetProceduralArtworkConfig(): void {
  currentConfig = { ...DEFAULT_CONFIG };
}

/**
 * Check if procedural artwork is enabled
 */
export function isProceduralArtworkEnabled(): boolean {
  return currentConfig.enabled;
}

/**
 * Enable or disable procedural artwork
 */
export function setProceduralArtworkEnabled(enabled: boolean): void {
  currentConfig.enabled = enabled;
}
