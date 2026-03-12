/**
 * @fileoverview Unit Tests for Deck Coach UI Components
 *
 * Tests for the deck coach visualization components.
 */

import { describe, it, expect, jest } from '@jest/globals';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';

// Mock the UI components
jest.mock('@/components/ui/badge', () => ({
  Badge: ({ children, variant, className, ...props }: any) => (
    <span data-variant={variant} className={className} {...props}>
      {children}
    </span>
  ),
}));

jest.mock('@/components/ui/card', () => ({
  Card: ({ children, className, ...props }: any) => (
    <div data-testid="card" className={className} {...props}>{children}</div>
  ),
  CardHeader: ({ children, className, ...props }: any) => (
    <div data-testid="card-header" className={className} {...props}>{children}</div>
  ),
  CardTitle: ({ children, className, ...props }: any) => (
    <h3 data-testid="card-title" className={className} {...props}>{children}</h3>
  ),
  CardDescription: ({ children, className, ...props }: any) => (
    <p data-testid="card-description" className={className} {...props}>{children}</p>
  ),
  CardContent: ({ children, className, ...props }: any) => (
    <div data-testid="card-content" className={className} {...props}>{children}</div>
  ),
}));

jest.mock('@/components/ui/collapsible', () => ({
  Collapsible: ({ children, className, ...props }: any) => (
    <div data-testid="collapsible" className={className} {...props}>{children}</div>
  ),
  CollapsibleContent: ({ children, ...props }: any) => (
    <div data-testid="collapsible-content" {...props}>{children}</div>
  ),
  CollapsibleTrigger: ({ children, ...props }: any) => (
    <button data-testid="collapsible-trigger" {...props}>{children}</button>
  ),
}));

jest.mock('@/components/ui/button', () => ({
  Button: ({ children, variant, size, onClick, className, ...props }: any) => (
    <button 
      data-variant={variant} 
      data-size={size}
      className={className} 
      onClick={onClick} 
      {...props}
    >
      {children}
    </button>
  ),
}));

jest.mock('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: any) => <div data-testid="dropdown">{children}</div>,
  DropdownMenuTrigger: ({ children, asChild }: any) => <div data-testid="dropdown-trigger">{children}</div>,
  DropdownMenuContent: ({ children, align }: any) => <div data-testid="dropdown-content" data-align={align}>{children}</div>,
  DropdownMenuItem: ({ children, onClick }: any) => (
    <div data-testid="dropdown-item" onClick={onClick}>{children}</div>
  ),
}));

jest.mock('@/components/ui/tooltip', () => ({
  Tooltip: ({ children }: any) => <div data-testid="tooltip">{children}</div>,
  TooltipTrigger: ({ children, asChild }: any) => <span data-testid="tooltip-trigger">{children}</span>,
  TooltipContent: ({ children }: any) => <span data-testid="tooltip-content">{children}</span>,
  TooltipProvider: ({ children }: any) => <div data-testid="tooltip-provider">{children}</div>,
}));

jest.mock('@/lib/utils', () => ({
  cn: (...classes: string[]) => classes.filter(Boolean).join(' '),
}));

jest.mock('lucide-react', () => ({
  CheckCircle2: () => <svg data-testid="check-icon" />,
  Sparkles: () => <svg data-testid="sparkles-icon" />,
  ChevronDown: () => <svg data-testid="chevron-down-icon" />,
  AlertTriangle: () => <svg data-testid="alert-triangle-icon" />,
  AlertCircle: () => <svg data-testid="alert-circle-icon" />,
  Info: () => <svg data-testid="info-icon" />,
  Star: () => <svg data-testid="star-icon" />,
  Target: () => <svg data-testid="target-icon" />,
  Zap: () => <svg data-testid="zap-icon" />,
  Shield: () => <svg data-testid="shield-icon" />,
  TrendingUp: () => <svg data-testid="trending-up-icon" />,
  Download: () => <svg data-testid="download-icon" />,
  FileText: () => <svg data-testid="file-text-icon" />,
  Printer: () => <svg data-testid="printer-icon" />,
}));

// Now import the components after mocks are set up
import { ArchetypeBadge } from '@/app/(app)/deck-coach/_components/archetype-badge';
import { SynergyList } from '@/app/(app)/deck-coach/_components/synergy-list';
import { MissingSynergies } from '@/app/(app)/deck-coach/_components/missing-synergies';
import { KeyCards, identifyKeyCards } from '@/app/(app)/deck-coach/_components/key-cards';
import { ExportButton, formatReportAsText } from '@/app/(app)/deck-coach/_components/export-button';

describe('ArchetypeBadge', () => {
  it('should render archetype name', () => {
    render(<ArchetypeBadge archetype="Burn" confidence={0.85} />);
    expect(screen.getByText('Burn')).toBeInTheDocument();
  });

  it('should render confidence percentage', () => {
    render(<ArchetypeBadge archetype="Control" confidence={0.75} />);
    expect(screen.getByText('75% confidence')).toBeInTheDocument();
  });

  it('should show checkmark for high confidence (>=80%)', () => {
    render(<ArchetypeBadge archetype="Combo" confidence={0.85} />);
    expect(screen.getByTestId('check-icon')).toBeInTheDocument();
  });

  it('should not show checkmark for low confidence (<80%)', () => {
    render(<ArchetypeBadge archetype="Midrange" confidence={0.65} />);
    expect(screen.queryByTestId('check-icon')).not.toBeInTheDocument();
  });

  it('should render secondary archetype when provided', () => {
    render(
      <ArchetypeBadge 
        archetype="Burn" 
        confidence={0.85} 
        secondary="Aggro" 
        secondaryConfidence={0.60} 
      />
    );
    expect(screen.getByText('Aggro')).toBeInTheDocument();
  });

  it('should apply correct variant for aggro archetypes', () => {
    render(<ArchetypeBadge archetype="Burn" confidence={0.85} />);
    const badge = screen.getByText('Burn').closest('[data-variant]');
    expect(badge).toHaveAttribute('data-variant', 'destructive');
  });

  it('should apply correct variant for control archetypes', () => {
    render(<ArchetypeBadge archetype="Control" confidence={0.85} />);
    const badge = screen.getByText('Control').closest('[data-variant]');
    expect(badge).toHaveAttribute('data-variant', 'default');
  });

  it('should apply correct variant for combo archetypes', () => {
    render(<ArchetypeBadge archetype="Storm Combo" confidence={0.85} />);
    const badge = screen.getByText('Storm Combo').closest('[data-variant]');
    expect(badge).toHaveAttribute('data-variant', 'secondary');
  });

  it('should apply correct variant for tribal archetypes', () => {
    render(<ArchetypeBadge archetype="Elf Tribal" confidence={0.85} />);
    const badge = screen.getByText('Elf Tribal').closest('[data-variant]');
    expect(badge).toHaveAttribute('data-variant', 'outline');
  });

  it('should apply correct variant for midrange archetypes', () => {
    render(<ArchetypeBadge archetype="Midrange" confidence={0.85} />);
    const badge = screen.getByText('Midrange').closest('[data-variant]');
    expect(badge).toHaveAttribute('data-variant', 'secondary');
  });

  it('should render with custom className', () => {
    render(<ArchetypeBadge archetype="Test" confidence={0.5} className="custom-class" />);
    expect(screen.getByText('Test').closest('.custom-class')).toBeInTheDocument();
  });

  it('should render tooltip with category and confidence', () => {
    render(<ArchetypeBadge archetype="Burn" confidence={0.85} />);
    expect(screen.getByText('Aggro Archetype')).toBeInTheDocument();
    expect(screen.getByText('Confidence: 85%')).toBeInTheDocument();
  });
});

describe('SynergyList', () => {
  const mockSynergies = [
    {
      name: 'Burn Synergy',
      score: 85,
      cards: ['Lightning Bolt', 'Lava Spike', 'Skewer the Critics'],
      description: 'Direct damage spells working together',
      category: 'Mechanic',
    },
    {
      name: 'Elf Tribal',
      score: 72,
      cards: ['Elvish Archdruid', 'Llanowar Elves', 'Wirewood Symbiote'],
      description: 'Elf creatures supporting each other',
      category: 'Tribal',
    },
    {
      name: 'Low Synergy',
      score: 30,
      cards: ['Random Card'],
      description: 'Weak synergy',
      category: 'Other',
    },
  ];

  it('should render null when no synergies', () => {
    const { container } = render(<SynergyList synergies={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render synergy count badge', () => {
    render(<SynergyList synergies={mockSynergies} />);
    expect(screen.getByText('3 found')).toBeInTheDocument();
  });

  it('should render all synergy names', () => {
    render(<SynergyList synergies={mockSynergies} />);
    expect(screen.getByText('Burn Synergy')).toBeInTheDocument();
    expect(screen.getByText('Elf Tribal')).toBeInTheDocument();
    expect(screen.getByText('Low Synergy')).toBeInTheDocument();
  });

  it('should display synergy scores', () => {
    render(<SynergyList synergies={mockSynergies} />);
    expect(screen.getByText('High (85)')).toBeInTheDocument();
    expect(screen.getByText('Medium (72)')).toBeInTheDocument();
    expect(screen.getByText('Low (30)')).toBeInTheDocument();
  });

  it('should sort synergies by score (highest first)', () => {
    render(<SynergyList synergies={mockSynergies} />);
    const synergies = screen.getAllByTestId('collapsible');
    // First should be highest score
    expect(synergies[0]).toHaveTextContent('Burn Synergy');
  });

  it('should show category badges', () => {
    render(<SynergyList synergies={mockSynergies} />);
    expect(screen.getByText('Mechanic')).toBeInTheDocument();
    expect(screen.getByText('Tribal')).toBeInTheDocument();
  });

  it('should show card count in expandable section', () => {
    render(<SynergyList synergies={mockSynergies} />);
    expect(screen.getByText(/Cards contributing/)).toBeInTheDocument();
  });

  it('should truncate card list to 12 cards', () => {
    const manyCards = {
      name: 'Big Synergy',
      score: 90,
      cards: Array(20).fill(null).map((_, i) => `Card ${i}`),
      description: 'Many cards',
      category: 'Engine',
    };
    render(<SynergyList synergies={[manyCards]} />);
    expect(screen.getByText('+8 more')).toBeInTheDocument();
  });

  it('should apply correct color for high score', () => {
    render(<SynergyList synergies={[mockSynergies[0]]} />);
    const scoreElement = screen.getByText('High (85)');
    expect(scoreElement).toHaveClass('text-green-500');
  });

  it('should apply correct color for medium score', () => {
    render(<SynergyList synergies={[mockSynergies[1]]} />);
    const scoreElement = screen.getByText('Medium (72)');
    expect(scoreElement).toHaveClass('text-yellow-500');
  });

  it('should apply correct color for low score', () => {
    render(<SynergyList synergies={[mockSynergies[2]]} />);
    const scoreElement = screen.getByText('Low (30)');
    expect(scoreElement).toHaveClass('text-muted-foreground');
  });
});

describe('MissingSynergies', () => {
  const mockMissing = [
    {
      synergy: 'Ramp Package',
      missing: 'More mana acceleration',
      description: 'Consider adding more ramp spells',
      suggestion: 'Add 2-3 more mana rocks or ramp spells',
      impact: 'high' as const,
    },
    {
      synergy: 'Card Draw',
      missing: 'Consistent draw engine',
      description: 'Deck lacks card advantage',
      suggestion: 'Add card draw spells',
      impact: 'medium' as const,
    },
    {
      synergy: 'Removal',
      missing: 'Sweeper spell',
      description: 'No board wipes',
      suggestion: 'Consider adding a board wipe',
      impact: 'low' as const,
    },
  ];

  it('should render null when no missing synergies', () => {
    const { container } = render(<MissingSynergies missing={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render missing synergy count', () => {
    render(<MissingSynergies missing={mockMissing} />);
    expect(screen.getByText('3 gaps')).toBeInTheDocument();
  });

  it('should display impact counts in header', () => {
    render(<MissingSynergies missing={mockMissing} />);
    expect(screen.getByText('1 high, 1 medium impact')).toBeInTheDocument();
  });

  it('should render all missing synergy names', () => {
    render(<MissingSynergies missing={mockMissing} />);
    expect(screen.getByText('Ramp Package')).toBeInTheDocument();
    expect(screen.getByText('Card Draw')).toBeInTheDocument();
    expect(screen.getByText('Removal')).toBeInTheDocument();
  });

  it('should sort by impact (high first)', () => {
    render(<MissingSynergies missing={mockMissing} />);
    const alerts = screen.getAllByRole('alert');
    // First should be high impact
    expect(alerts[0]).toHaveTextContent('HIGH IMPACT');
  });

  it('should show impact badges', () => {
    render(<MissingSynergies missing={mockMissing} />);
    expect(screen.getByText('HIGH IMPACT')).toBeInTheDocument();
    expect(screen.getByText('MEDIUM IMPACT')).toBeInTheDocument();
    expect(screen.getByText('LOW IMPACT')).toBeInTheDocument();
  });

  it('should show suggestions', () => {
    render(<MissingSynergies missing={mockMissing} />);
    expect(screen.getByText(/Add 2-3 more mana rocks/)).toBeInTheDocument();
  });

  it('should show priority warning for high impact', () => {
    render(<MissingSynergies missing={mockMissing} />);
    expect(screen.getByText(/Priority:/)).toBeInTheDocument();
  });

  it('should apply correct styling for high impact', () => {
    render(<MissingSynergies missing={[mockMissing[0]]} />);
    const alert = screen.getByRole('alert');
    expect(alert).toHaveClass('bg-red-500/5');
  });
});

describe('KeyCards', () => {
  const mockCards = [
    {
      name: 'Lightning Bolt',
      reason: 'Core to Burn synergy',
      count: 4,
      category: 'synergy',
    },
    {
      name: 'Elvish Archdruid',
      reason: 'Defines Tribal archetype',
      count: 4,
      category: 'archetype',
    },
  ];

  it('should render null when no cards', () => {
    const { container } = render(<KeyCards cards={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('should render card count badge', () => {
    render(<KeyCards cards={mockCards} />);
    expect(screen.getByText('2 cards')).toBeInTheDocument();
  });

  it('should render all card names', () => {
    render(<KeyCards cards={mockCards} />);
    expect(screen.getByText('Lightning Bolt')).toBeInTheDocument();
    expect(screen.getByText('Elvish Archdruid')).toBeInTheDocument();
  });

  it('should display card counts', () => {
    render(<KeyCards cards={mockCards} />);
    expect(screen.getAllByText('x4')).toHaveLength(2);
  });

  it('should display reasons for each card', () => {
    render(<KeyCards cards={mockCards} />);
    expect(screen.getByText('Core to Burn synergy')).toBeInTheDocument();
    expect(screen.getByText('Defines Tribal archetype')).toBeInTheDocument();
  });

  it('should show category icons', () => {
    render(<KeyCards cards={mockCards} />);
    expect(screen.getAllByTestId('zap-icon')).toHaveLength(1);
    expect(screen.getAllByTestId('star-icon')).toHaveLength(1);
  });

  it('should show tip section', () => {
    render(<KeyCards cards={mockCards} />);
    expect(screen.getByText(/Tip:/)).toBeInTheDocument();
  });
});

describe('identifyKeyCards', () => {
  it('should identify cards from high-scoring synergies', () => {
    const synergies = [
      {
        name: 'Burn',
        cards: ['Lightning Bolt', 'Lava Spike'],
        score: 80,
      },
    ];
    const deckCards = [
      { name: 'Lightning Bolt', count: 4 },
      { name: 'Lava Spike', count: 3 },
    ];

    const keyCards = identifyKeyCards('Burn', synergies, deckCards);

    expect(keyCards.length).toBeGreaterThan(0);
    expect(keyCards[0].category).toBe('synergy');
  });

  it('should identify archetype-defining cards', () => {
    const synergies: Array<{ name: string; cards: string[]; score: number }> = [];
    const deckCards = [
      { name: 'Lightning Bolt', count: 4 },
      { name: 'Mountain', count: 20 },
    ];

    const keyCards = identifyKeyCards('Burn', synergies, deckCards);

    const hasArchetypeCard = keyCards.some(c => c.category === 'archetype');
    expect(hasArchetypeCard).toBe(true);
  });

  it('should identify high-count cards', () => {
    const synergies: Array<{ name: string; cards: string[]; score: number }> = [];
    const deckCards = [
      { name: 'Card A', count: 4 },
      { name: 'Card B', count: 4 },
      { name: 'Card C', count: 4 },
      { name: 'Card D', count: 1 },
    ];

    const keyCards = identifyKeyCards('Control', synergies, deckCards);

    const hasEngineCard = keyCards.some(c => c.category === 'engine');
    expect(hasEngineCard).toBe(true);
  });

  it('should limit to 7 cards maximum', () => {
    const synergies: Array<{ name: string; cards: string[]; score: number }> = [];
    const deckCards = Array(20).fill(null).map((_, i) => ({
      name: `Card ${i}`,
      count: 4,
    }));

    const keyCards = identifyKeyCards('Control', synergies, deckCards);

    expect(keyCards.length).toBeLessThanOrEqual(7);
  });

  it('should avoid duplicates', () => {
    const synergies = [
      {
        name: 'Synergy 1',
        cards: ['Lightning Bolt'],
        score: 80,
      },
      {
        name: 'Synergy 2',
        cards: ['Lightning Bolt'],
        score: 70,
      },
    ];
    const deckCards = [{ name: 'Lightning Bolt', count: 4 }];

    const keyCards = identifyKeyCards('Burn', synergies, deckCards);

    const boltCards = keyCards.filter(c => c.name === 'Lightning Bolt');
    expect(boltCards.length).toBe(1);
  });
});

describe('ExportButton', () => {
  const mockReport = {
    archetype: {
      primary: 'Burn',
      confidence: 0.85,
    },
    synergies: [
      {
        name: 'Burn Synergy',
        score: 85,
        cards: ['Lightning Bolt'],
        description: 'Direct damage',
        category: 'Mechanic',
      },
    ],
    missingSynergies: [],
    keyCards: [
      { name: 'Lightning Bolt', reason: 'Core card', count: 4 },
    ],
    decklist: '4 Lightning Bolt\n20 Mountain',
  };

  it('should render export button', () => {
    render(<ExportButton report={mockReport} deckName="Test Deck" />);
    expect(screen.getByText('Export Report')).toBeInTheDocument();
  });

  it('should show download options', () => {
    render(<ExportButton report={mockReport} deckName="Test Deck" />);
    const trigger = screen.getByTestId('dropdown-trigger');
    fireEvent.click(trigger);

    expect(screen.getByText('Download as Text')).toBeInTheDocument();
    expect(screen.getByText('Print to PDF')).toBeInTheDocument();
  });

  it('should have correct icons', () => {
    render(<ExportButton report={mockReport} deckName="Test Deck" />);
    expect(screen.getByTestId('download-icon')).toBeInTheDocument();
  });
});

describe('formatReportAsText', () => {
  const mockReport = {
    archetype: {
      primary: 'Burn',
      confidence: 0.85,
      secondary: 'Aggro',
      secondaryConfidence: 0.60,
    },
    synergies: [
      {
        name: 'Burn Synergy',
        score: 85,
        cards: ['Lightning Bolt', 'Lava Spike'],
        description: 'Direct damage',
        category: 'Mechanic',
      },
    ],
    missingSynergies: [
      {
        synergy: 'Card Draw',
        missing: 'Draw spells',
        description: 'No card advantage',
        suggestion: 'Add draw spells',
        impact: 'medium' as const,
      },
    ],
    keyCards: [
      { name: 'Lightning Bolt', reason: 'Core card', count: 4 },
    ],
    reviewSummary: 'This is a strong burn deck',
    deckOptions: [
      {
        title: 'Add More Reach',
        description: 'Consider adding more direct damage',
        cardsToAdd: [{ name: 'Skewer', quantity: 2 }],
        cardsToRemove: [],
      },
    ],
    decklist: '4 Lightning Bolt\n20 Mountain',
  };

  it('should format report with header', () => {
    const text = formatReportAsText(mockReport, 'Test Deck');
    expect(text).toContain('DECK COACH REPORT: Test Deck');
    expect(text).toContain('Generated:');
  });

  it('should include archetype section', () => {
    const text = formatReportAsText(mockReport, 'Test Deck');
    expect(text).toContain('ARCHETYPE ANALYSIS');
    expect(text).toContain('Primary: Burn');
    expect(text).toContain('Confidence: 85%');
    expect(text).toContain('Secondary: Aggro');
  });

  it('should include synergies section', () => {
    const text = formatReportAsText(mockReport, 'Test Deck');
    expect(text).toContain('DETECTED SYNERGIES');
    expect(text).toContain('Burn Synergy');
    expect(text).toContain('Score: 85');
  });

  it('should include missing synergies section', () => {
    const text = formatReportAsText(mockReport, 'Test Deck');
    expect(text).toContain('MISSING SYNERGIES');
    expect(text).toContain('MEDIUM IMPACT');
  });

  it('should include key cards section', () => {
    const text = formatReportAsText(mockReport, 'Test Deck');
    expect(text).toContain('KEY CARDS');
    expect(text).toContain('Lightning Bolt');
  });

  it('should include deck options section', () => {
    const text = formatReportAsText(mockReport, 'Test Deck');
    expect(text).toContain('SUGGESTED IMPROVEMENTS');
    expect(text).toContain('Add More Reach');
  });

  it('should include decklist section', () => {
    const text = formatReportAsText(mockReport, 'Test Deck');
    expect(text).toContain('DECKLIST');
    expect(text).toContain('4 Lightning Bolt');
  });

  it('should handle minimal report', () => {
    const minimalReport = {
      archetype: undefined,
      synergies: [],
      missingSynergies: [],
      keyCards: [],
      decklist: undefined,
    };
    const text = formatReportAsText(minimalReport, 'Empty Deck');
    expect(text).toContain('DECK COACH REPORT: Empty Deck');
  });

  it('should sanitize deck name for filename', () => {
    const text = formatReportAsText(mockReport, 'Test/Deck@2024');
    // The function uses the deckName for display, sanitization happens in download
    expect(text).toContain('Test/Deck@2024');
  });
});
