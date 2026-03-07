'use client';

import { useState } from 'react';
import { CardArt } from '@/components/card-art';
import { useAutoStyledArtwork } from '@/hooks/use-procedural-artwork';

/**
 * Procedural Artwork Demo Page
 *
 * Demonstrates the procedural artwork generation system for cards.
 * Shows how different card properties affect the generated artwork.
 */

interface DemoCard {
  id: string;
  name: string;
  colors: string[];
  typeLine: string;
  cmc: number;
  description: string;
}

const demoCards: DemoCard[] = [
  {
    id: 'demo-001',
    name: 'Crimson Dragon',
    colors: ['R'],
    typeLine: 'Legendary Creature — Dragon',
    cmc: 5,
    description: 'Red creature, high CMC - aggressive mood',
  },
  {
    id: 'demo-002',
    name: 'Azure Mind',
    colors: ['U'],
    typeLine: 'Creature — Wizard',
    cmc: 3,
    description: 'Blue creature - mysterious mood',
  },
  {
    id: 'demo-003',
    name: 'Emerald Guardian',
    colors: ['G'],
    typeLine: 'Creature — Elf Druid',
    cmc: 2,
    description: 'Green creature, low CMC - peaceful mood',
  },
  {
    id: 'demo-004',
    name: 'Void Walker',
    colors: ['B'],
    typeLine: 'Creature — Spirit',
    cmc: 4,
    description: 'Black creature - mysterious mood',
  },
  {
    id: 'demo-005',
    name: 'Sunfire Blast',
    colors: ['R', 'W'],
    typeLine: 'Instant',
    cmc: 3,
    description: 'Red/white instant - energetic mood',
  },
  {
    id: 'demo-006',
    name: 'Aether Engine',
    colors: ['U', 'R'],
    typeLine: 'Artifact',
    cmc: 4,
    description: 'Red/blue artifact - sci-fi style',
  },
  {
    id: 'demo-007',
    name: 'Forest Blessing',
    colors: ['G'],
    typeLine: 'Enchantment — Aura',
    cmc: 2,
    description: 'Green enchantment - fantasy style',
  },
  {
    id: 'demo-008',
    name: 'Plasma Storm',
    colors: ['R'],
    typeLine: 'Sorcery',
    cmc: 4,
    description: 'Red sorcery - abstract style, energetic',
  },
  {
    id: 'demo-009',
    name: 'Crystal Shield',
    colors: ['W', 'U'],
    typeLine: 'Artifact',
    cmc: 3,
    description: 'White/blue artifact - peaceful mood',
  },
  {
    id: 'demo-010',
    name: 'Shadow Pact',
    colors: ['B'],
    typeLine: 'Enchantment',
    cmc: 3,
    description: 'Black enchantment - mysterious mood',
  },
];

export default function ProceduralArtDemo() {
  const [selectedCard, setSelectedCard] = useState<DemoCard | null>(null);
  const [useProcedural, setUseProcedural] = useState(true);

  const selectedCardArt = useAutoStyledArtwork(
    selectedCard
      ? {
          cardName: selectedCard.name,
          cardId: selectedCard.id,
          colors: selectedCard.colors,
          typeLine: selectedCard.typeLine,
          cmc: selectedCard.cmc,
          width: 744,
          height: 1039,
        }
      : {
          cardName: '',
          cardId: '',
          colors: [],
          typeLine: '',
          cmc: 0,
          width: 744,
          height: 1039,
        }
  );

  return (
    <div className="container mx-auto p-6 space-y-8">
      <div className="space-y-4">
        <h1 className="text-4xl font-bold">Procedural Artwork Generation System</h1>
        <p className="text-lg text-muted-foreground">
          Demonstrates the original, legal-safe procedural artwork generator for cards.
        </p>
      </div>

      {/* Controls */}
      <div className="bg-card border rounded-lg p-4 space-y-4">
        <h2 className="text-xl font-semibold">Controls</h2>
        <div className="flex items-center space-x-4">
          <label className="flex items-center space-x-2 cursor-pointer">
            <input
              type="checkbox"
              checked={useProcedural}
              onChange={(e) => setUseProcedural(e.target.checked)}
              className="w-4 h-4"
            />
            <span>Use Procedural Artwork</span>
          </label>
        </div>
      </div>

      {/* Gallery */}
      <div className="space-y-4">
        <h2 className="text-2xl font-semibold">Card Gallery</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {demoCards.map((card) => (
            <div
              key={card.id}
              className="space-y-2 cursor-pointer"
              onClick={() => setSelectedCard(card)}
            >
              <CardArt
                cardName={card.name}
                scryfallCard={{
                  id: card.id,
                  name: card.name,
                  color_identity: card.colors,
                  type_line: card.typeLine,
                  cmc: card.cmc,
                  colors: card.colors,
                }}
                size="small"
                useProcedural={useProcedural}
                enableZoom={false}
                lazy={false}
                showSkeleton={false}
              />
              <div className="text-sm">
                <p className="font-semibold truncate">{card.name}</p>
                <p className="text-muted-foreground text-xs truncate">
                  {card.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Detailed View */}
      {selectedCard && (
        <div className="bg-card border rounded-lg p-6 space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-2xl font-semibold">Detailed View: {selectedCard.name}</h2>
            <button
              onClick={() => setSelectedCard(null)}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90"
            >
              Close
            </button>
          </div>

          <div className="grid md:grid-cols-2 gap-6">
            {/* Card Display */}
            <div className="flex justify-center">
              <CardArt
                cardName={selectedCard.name}
                scryfallCard={{
                  id: selectedCard.id,
                  name: selectedCard.name,
                  color_identity: selectedCard.colors,
                  type_line: selectedCard.typeLine,
                  cmc: selectedCard.cmc,
                  colors: selectedCard.colors,
                }}
                size="large"
                useProcedural={useProcedural}
                enableZoom={true}
                lazy={false}
                showSkeleton={false}
              />
            </div>

            {/* Card Details */}
            <div className="space-y-4">
              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold">Card Properties</h3>
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Name:</span>
                    <span className="ml-2">{selectedCard.name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Colors:</span>
                    <span className="ml-2">{selectedCard.colors.join(', ') || 'Colorless'}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Type:</span>
                    <span className="ml-2">{selectedCard.typeLine}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">CMC:</span>
                    <span className="ml-2">{selectedCard.cmc}</span>
                  </div>
                </div>
              </div>

              <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                <h3 className="font-semibold">Artwork Style Determination</h3>
                <div className="space-y-2 text-sm">
                  <div>
                    <span className="text-muted-foreground">Description:</span>
                    <span className="ml-2">{selectedCard.description}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Determined Mood:</span>
                    <span className="ml-2">
                      {selectedCard.colors.includes('R') && selectedCard.cmc > 4
                        ? 'Aggressive'
                        : selectedCard.colors.includes('U') || selectedCard.colors.includes('B')
                        ? 'Mysterious'
                        : selectedCard.colors.includes('R') || selectedCard.colors.includes('G')
                        ? 'Energetic'
                        : 'Peaceful'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Determined Complexity:</span>
                    <span className="ml-2">
                      {selectedCard.cmc <= 2
                        ? 'Simple'
                        : selectedCard.cmc <= 4
                        ? 'Medium'
                        : 'Complex'}
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Determined Style:</span>
                    <span className="ml-2">
                      {selectedCard.typeLine.toLowerCase().includes('artifact')
                        ? 'Sci-Fi'
                        : selectedCard.typeLine.toLowerCase().includes('enchantment')
                        ? 'Fantasy'
                        : selectedCard.typeLine.toLowerCase().includes('instant') ||
                          selectedCard.typeLine.toLowerCase().includes('sorcery')
                        ? 'Abstract'
                        : 'Fantasy'}
                    </span>
                  </div>
                </div>
              </div>

              {useProcedural && (
                <div className="bg-muted/50 rounded-lg p-4 space-y-2">
                  <h3 className="font-semibold">Procedural Artwork Info</h3>
                  <div className="space-y-2 text-sm">
                    <div>
                      <span className="text-muted-foreground">Cache Key:</span>
                      <span className="ml-2 break-all text-xs font-mono">
                        {selectedCard.id}-fantasy-{selectedCard.cmc <= 2 ? 'simple' : selectedCard.cmc <= 4 ? 'medium' : 'complex'}-
                        {selectedCard.colors.includes('R') && selectedCard.cmc > 4
                          ? 'aggressive'
                          : selectedCard.colors.includes('U') || selectedCard.colors.includes('B')
                          ? 'mysterious'
                          : selectedCard.colors.includes('R') || selectedCard.colors.includes('G')
                          ? 'energetic'
                          : 'peaceful'}-744x1039
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Information */}
      <div className="bg-card border rounded-lg p-6 space-y-4">
        <h2 className="text-2xl font-semibold">About This System</h2>
        <div className="space-y-4 text-sm">
          <p>
            This procedural artwork generation system creates unique, legal-safe card artwork
            using deterministic algorithms. Each card receives consistent artwork based on its
            properties:
          </p>
          <ul className="list-disc list-inside space-y-2 ml-4">
            <li>
              <strong>Card Colors:</strong> Influence the color palette and mood of the artwork
            </li>
            <li>
              <strong>Converted Mana Cost (CMC):</strong> Determines the complexity of shapes and
              details
            </li>
            <li>
              <strong>Card Type:</strong> Influences the artistic style (fantasy, sci-fi, abstract,
              geometric)
            </li>
            <li>
              <strong>Card ID:</strong> Used as a seed for deterministic generation, ensuring the
              same card always looks the same
            </li>
          </ul>
          <div className="space-y-2">
            <h3 className="font-semibold">Features:</h3>
            <ul className="list-disc list-inside space-y-1 ml-4">
              <li>100% client-side generation - no external dependencies</li>
              <li>Deterministic output - same card = same artwork</li>
              <li>Cached for performance - generates once, reuses forever</li>
              <li>Legal-safe - no copyright concerns</li>
              <li>Responsive - scales to any size</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
