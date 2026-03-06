'use client';

import { useState, useEffect } from 'react';
import { CardArt } from '@/components/card-art';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { artworkCache } from '@/components/card-art';

/**
 * Procedural Artwork Demo Page
 *
 * Demonstrates the procedural artwork generation system with various card types
 */

interface DemoCard {
  name: string;
  typeLine: string;
  colors: string[];
  cmc: number;
  variant?: number;
}

const demoCards: DemoCard[] = [
  // Creatures
  { name: 'Eternal Dragon', typeLine: 'Creature — Dragon Spirit', colors: ['W'], cmc: 7 },
  { name: 'Void Stalker', typeLine: 'Creature — Elemental Horror', colors: ['U', 'B'], cmc: 5 },
  { name: 'Fiery Ember', typeLine: 'Creature — Phoenix', colors: ['R'], cmc: 4 },
  { name: 'Forest Guardian', typeLine: 'Creature — Elf Druid', colors: ['G'], cmc: 3 },

  // Spells
  { name: 'Lightning Strike', typeLine: 'Instant', colors: ['R'], cmc: 2 },
  { name: 'Counterspell', typeLine: 'Instant', colors: ['U'], cmc: 2 },
  { name: 'Dark Ritual', typeLine: 'Instant', colors: ['B'], cmc: 1 },
  { name: 'Healing Touch', typeLine: 'Instant', colors: ['G'], cmc: 2 },
  { name: 'Swords to Plowshares', typeLine: 'Instant', colors: ['W'], cmc: 1 },

  // Sorceries
  { name: 'Fireball', typeLine: 'Sorcery', colors: ['R'], cmc: 6 },
  { name: 'Mind Rot', typeLine: 'Sorcery', colors: ['B'], cmc: 3 },
  { name: 'Explosive Vegetation', typeLine: 'Sorcery', colors: ['G'], cmc: 4 },

  // Artifacts
  { name: 'Sol Ring', typeLine: 'Artifact', colors: [], cmc: 1 },
  { name: 'Mana Vault', typeLine: 'Artifact', colors: [], cmc: 0 },
  { name: 'Worn Powerstone', typeLine: 'Artifact', colors: [], cmc: 3 },

  // Enchantments
  { name: 'Flight', typeLine: 'Enchantment — Aura', colors: ['U'], cmc: 1 },
  { name: 'Giant Growth', typeLine: 'Enchantment — Aura', colors: ['G'], cmc: 1 },
  { name: 'Unholy Strength', typeLine: 'Enchantment — Aura', colors: ['B'], cmc: 1 },

  // Lands
  { name: 'Forest', typeLine: 'Land', colors: ['G'], cmc: 0 },
  { name: 'Island', typeLine: 'Land', colors: ['U'], cmc: 0 },
  { name: 'Mountain', typeLine: 'Land', colors: ['R'], cmc: 0 },
  { name: 'Plains', typeLine: 'Land', colors: ['W'], cmc: 0 },
  { name: 'Swamp', typeLine: 'Land', colors: ['B'], cmc: 0 },

  // Multicolor
  { name: 'Sphinx of the Steel Wind', typeLine: 'Creature — Sphinx', colors: ['W', 'U', 'B'], cmc: 7 },
  { name: 'Maelstrom Nexus', typeLine: 'Artifact', colors: ['W', 'U', 'B', 'R', 'G'], cmc: 5 },
  { name: 'Nicol Bolas, Planeswalker', typeLine: 'Planeswalker', colors: ['U', 'B', 'R'], cmc: 8 },
];

export default function ArtworkDemoPage() {
  const [selectedCards, setSelectedCards] = useState<DemoCard[]>([]);
  const [useProcedural, setUseProcedural] = useState(true);
  const [cacheStats, setCacheStats] = useState<{ memoryCacheSize: number; dbCacheSize: number; totalSizeEstimate: string } | null>(null);
  const [regenerating, setRegenerating] = useState(false);

  // Load cache stats
  useEffect(() => {
    loadCacheStats();
  }, []);

  const loadCacheStats = async () => {
    try {
      const stats = await artworkCache.getStats();
      setCacheStats(stats);
    } catch (error) {
      console.error('Failed to load cache stats:', error);
    }
  };

  const handleGenerateVariants = () => {
    setRegenerating(true);
    // Generate new variants for selected cards
    setTimeout(() => {
      setSelectedCards(selectedCards.map(card => ({
        ...card,
        variant: (card.variant || 0) + 1
      })));
      setRegenerating(false);
      loadCacheStats();
    }, 100);
  };

  const handleClearCache = async () => {
    try {
      await artworkCache.clear();
      loadCacheStats();
      // Force re-render by incrementing variants
      setSelectedCards(selectedCards.map(card => ({
        ...card,
        variant: (card.variant || 0) + 2
      })));
    } catch (error) {
      console.error('Failed to clear cache:', error);
    }
  };

  const handleSelectAll = () => {
    setSelectedCards([...demoCards]);
  };

  const handleDeselectAll = () => {
    setSelectedCards([]);
  };

  const handleToggleCard = (card: DemoCard) => {
    setSelectedCards(prev => {
      const exists = prev.some(c => c.name === card.name);
      if (exists) {
        return prev.filter(c => c.name !== card.name);
      } else {
        return [...prev, { ...card, variant: 0 }];
      }
    });
  };

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Procedural Artwork Generation</h1>
        <p className="text-muted-foreground mb-4">
          Demonstration of the legal-safe procedural artwork generation system for card visuals.
        </p>

        {/* Controls */}
        <div className="flex flex-wrap gap-4 mb-6">
          <Button onClick={handleSelectAll} variant="outline">
            Select All
          </Button>
          <Button onClick={handleDeselectAll} variant="outline">
            Deselect All
          </Button>
          <Button
            onClick={handleGenerateVariants}
            disabled={selectedCards.length === 0 || regenerating}
            variant="default"
          >
            {regenerating ? 'Generating...' : 'Generate Variants'}
          </Button>
          <Button onClick={handleClearCache} variant="destructive">
            Clear Cache
          </Button>
          <Button
            onClick={() => setUseProcedural(!useProcedural)}
            variant={useProcedural ? 'default' : 'outline'}
          >
            {useProcedural ? 'Procedural Art: ON' : 'Procedural Art: OFF'}
          </Button>
        </div>

        {/* Cache Stats */}
        {cacheStats && (
          <Card className="mb-6 p-4">
            <h3 className="font-semibold mb-2">Cache Statistics</h3>
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div>
                <div className="text-muted-foreground">Memory Cache</div>
                <div className="font-mono">{cacheStats.memoryCacheSize} items</div>
              </div>
              <div>
                <div className="text-muted-foreground">Database Cache</div>
                <div className="font-mono">{cacheStats.dbCacheSize} items</div>
              </div>
              <div>
                <div className="text-muted-foreground">Total Size</div>
                <div className="font-mono">{cacheStats.totalSizeEstimate}</div>
              </div>
            </div>
          </Card>
        )}

        {/* Card Selection Grid */}
        <div className="mb-8">
          <h2 className="text-2xl font-semibold mb-4">Available Cards ({demoCards.length})</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
            {demoCards.map((card) => (
              <Card
                key={card.name}
                className={`p-4 cursor-pointer transition-all ${
                  selectedCards.some(c => c.name === card.name)
                    ? 'ring-2 ring-primary'
                    : 'hover:ring-2 hover:ring-primary/50'
                }`}
                onClick={() => handleToggleCard(card)}
              >
                <div className="text-sm font-medium mb-1">{card.name}</div>
                <div className="text-xs text-muted-foreground">{card.typeLine}</div>
                <div className="flex gap-1 mt-2">
                  {card.colors.length > 0 ? (
                    card.colors.map((color) => (
                      <div
                        key={color}
                        className={`w-4 h-4 rounded ${
                          color === 'W' ? 'bg-yellow-100' :
                          color === 'U' ? 'bg-blue-400' :
                          color === 'B' ? 'bg-gray-800' :
                          color === 'R' ? 'bg-red-500' :
                          color === 'G' ? 'bg-green-500' :
                          'bg-gray-400'
                        }`}
                        title={color}
                      />
                    ))
                  ) : (
                    <div className="w-4 h-4 rounded bg-gray-400" title="Colorless" />
                  )}
                </div>
              </Card>
            ))}
          </div>
        </div>

        {/* Generated Artwork Display */}
        {selectedCards.length > 0 && (
          <div>
            <h2 className="text-2xl font-semibold mb-4">
              Generated Artwork ({selectedCards.length})
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4">
              {selectedCards.map((card, index) => (
                <div key={`${card.name}-${card.variant}`} className="flex flex-col gap-2">
                  <CardArt
                    cardName={card.name}
                    typeLine={card.typeLine}
                    colors={card.colors}
                    cmc={card.cmc}
                    variant={card.variant}
                    size="normal"
                    useProceduralArt={useProcedural}
                    showSkeleton={true}
                    enableZoom={true}
                  />
                  <div className="text-xs text-center text-muted-foreground">
                    {card.name}
                    {card.variant && ` (v${card.variant})`}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
