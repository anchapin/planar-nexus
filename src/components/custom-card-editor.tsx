'use client';

import { useState, useCallback, useEffect } from 'react';
import { useToast } from '@/hooks/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { 
  Palette, 
  Type, 
  Image as ImageIcon, 
  Save, 
  Copy, 
  Download, 
  Trash2,
  Plus,
  X,
  RotateCcw,
  Upload
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  type CustomCardDefinition,
  type CardColor,
  type CardFrameStyle,
  type CardRarity,
  type CustomCardType,
  DEFAULT_CUSTOM_CARD,
  CARD_COLORS,
  FRAME_STYLE_COLORS,
  RARITY_COLORS,
  generateCustomCardId,
  validateCustomCard,
} from '@/lib/custom-card';

/**
 * Custom Card Editor Component
 * 
 * WYSIWYG editor for creating and editing custom Magic: The Gathering cards
 * Part of the Custom Card Creation Studio (Issue #593)
 */

export interface CustomCardEditorProps {
  /** Initial card data (for editing existing cards) */
  initialCard?: CustomCardDefinition;
  /** Callback when card is saved */
  onSave?: (card: CustomCardDefinition) => void;
  /** Callback when card is deleted */
  onDelete?: (cardId: string) => void;
  /** Callback when card is exported */
  onExport?: (card: CustomCardDefinition) => void;
  /** Callback when a new card is created */
  onCreateNew?: () => void;
  /** Enable read-only mode */
  readOnly?: boolean;
}

const CARD_TYPES: { value: CustomCardType; label: string; icon: string }[] = [
  { value: 'creature', label: 'Creature', icon: '🦄' },
  { value: 'instant', label: 'Instant', icon: '⚡' },
  { value: 'sorcery', label: 'Sorcery', icon: '🔮' },
  { value: 'artifact', label: 'Artifact', icon: '⚙️' },
  { value: 'enchantment', label: 'Enchantment', icon: '✨' },
  { value: 'planeswalker', label: 'Planeswalker', icon: '🧙' },
  { value: 'land', label: 'Land', icon: '🏔️' },
];

const FRAME_STYLES: { value: CardFrameStyle; label: string }[] = [
  { value: 'modern', label: 'Modern' },
  { value: 'old', label: 'Old School' },
  { value: 'future', label: 'Future' },
  { value: 'classic', label: 'Classic' },
  { value: 'mirrodin', label: 'Mirrodin' },
  { value: 'innistrad', label: 'Innistrad' },
  { value: 'zendikar', label: 'Zendikar' },
  { value: 'Ixalan', label: 'Ixalan' },
  { value: 'Strixhaven', label: 'Strixhaven' },
];

const RARITIES: { value: CardRarity; label: string }[] = [
  { value: 'common', label: 'Common' },
  { value: 'uncommon', label: 'Uncommon' },
  { value: 'rare', label: 'Rare' },
  { value: 'mythic', label: 'Mythic Rare' },
];

const COLOR_OPTIONS: CardColor[] = ['white', 'blue', 'black', 'red', 'green', 'colorless'];

export function CustomCardEditor({
  initialCard,
  onSave,
  onDelete,
  onExport,
  onCreateNew,
  readOnly = false,
}: CustomCardEditorProps) {
  const { toast } = useToast();
  
  // Initialize card state
  const [card, setCard] = useState<CustomCardDefinition>(() => {
    if (initialCard) {
      return initialCard;
    }
    return {
      ...DEFAULT_CUSTOM_CARD,
      id: generateCustomCardId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as CustomCardDefinition;
  });

  // Track if card has been modified
  const [isModified, setIsModified] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);

  // Reset card to initial state
  const handleReset = useCallback(() => {
    if (initialCard) {
      setCard(initialCard);
    } else {
      setCard({
        ...DEFAULT_CUSTOM_CARD,
        id: generateCustomCardId(),
        createdAt: Date.now(),
        updatedAt: Date.now(),
      } as CustomCardDefinition);
    }
    setIsModified(false);
    setErrors([]);
    toast({
      title: 'Card Reset',
      description: 'Card has been reset to its original state.',
    });
  }, [initialCard, toast]);

  // Update a specific field
  const updateField = useCallback(<K extends keyof CustomCardDefinition>(
    field: K,
    value: CustomCardDefinition[K]
  ) => {
    setCard(prev => ({
      ...prev,
      [field]: value,
      updatedAt: Date.now(),
    }));
    setIsModified(true);
  }, []);

  // Toggle a card type
  const toggleCardType = useCallback((type: CustomCardType) => {
    setCard(prev => {
      const types = prev.cardTypes.includes(type)
        ? prev.cardTypes.filter(t => t !== type)
        : [...prev.cardTypes, type];
      return { ...prev, cardTypes: types, updatedAt: Date.now() };
    });
    setIsModified(true);
  }, []);

  // Toggle a color
  const toggleColor = useCallback((color: CardColor) => {
    setCard(prev => {
      const colors = prev.colors.includes(color)
        ? prev.colors.filter(c => c !== color)
        : [...prev.colors, color];
      return { ...prev, colors, updatedAt: Date.now() };
    });
    setIsModified(true);
  }, []);

  // Handle save
  const handleSave = useCallback(() => {
    const validationErrors = validateCustomCard(card);
    if (validationErrors.length > 0) {
      setErrors(validationErrors);
      toast({
        variant: 'destructive',
        title: 'Validation Failed',
        description: validationErrors.join(', '),
      });
      return;
    }
    
    onSave?.(card);
    setIsModified(false);
    setErrors([]);
    toast({
      title: 'Card Saved',
      description: 'Your custom card has been saved.',
    });
  }, [card, onSave, toast]);

  // Handle delete
  const handleDelete = useCallback(() => {
    onDelete?.(card.id);
    toast({
      title: 'Card Deleted',
      description: 'Your custom card has been deleted.',
    });
  }, [card.id, onDelete, toast]);

  // Handle export as JSON
  const handleExport = useCallback(() => {
    const json = JSON.stringify(card, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${card.name || 'custom-card'}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    
    onExport?.(card);
    toast({
      title: 'Card Exported',
      description: 'Card has been exported as JSON.',
    });
  }, [card, onExport, toast]);

  // Handle new card
  const handleCreateNew = useCallback(() => {
    if (isModified) {
      if (!confirm('You have unsaved changes. Create a new card anyway?')) {
        return;
      }
    }
    onCreateNew?.();
    setCard({
      ...DEFAULT_CUSTOM_CARD,
      id: generateCustomCardId(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    } as CustomCardDefinition);
    setIsModified(false);
    setErrors([]);
  }, [isModified, onCreateNew]);

  // Update type line based on card types
  useEffect(() => {
    if (card.cardTypes.length > 0) {
      const typeLabels: Record<CustomCardType, string> = {
        creature: 'Creature',
        instant: 'Instant',
        sorcery: 'Sorcery',
        artifact: 'Artifact',
        enchantment: 'Enchantment',
        planeswalker: 'Planeswalker',
        land: 'Land',
        legendary: 'Legendary',
        token: 'Token',
      };
      
      const mainType = card.cardTypes.map(t => typeLabels[t]).join(' — ');
      if (!card.typeLine.includes('—')) {
        updateField('typeLine', mainType);
      }
    }
  }, [card.cardTypes]);

  return (
    <div className="flex flex-col lg:flex-row gap-6">
      {/* Editor Panel */}
      <div className="flex-1 space-y-4">
        {/* Header Actions */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h2 className="text-2xl font-bold">Card Editor</h2>
            {isModified && (
              <Badge variant="secondary" className="animate-pulse">
                Modified
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={handleReset} disabled={readOnly}>
              <RotateCcw className="w-4 h-4 mr-2" />
              Reset
            </Button>
            <Button variant="outline" size="sm" onClick={handleCreateNew} disabled={readOnly}>
              <Plus className="w-4 h-4 mr-2" />
              New
            </Button>
            <Button variant="outline" size="sm" onClick={handleExport}>
              <Download className="w-4 h-4 mr-2" />
              Export
            </Button>
            <Button size="sm" onClick={handleSave} disabled={readOnly}>
              <Save className="w-4 h-4 mr-2" />
              Save
            </Button>
          </div>
        </div>

        {/* Validation Errors */}
        {errors.length > 0 && (
          <Card className="border-destructive">
            <CardHeader className="py-2">
              <CardTitle className="text-destructive text-sm">Validation Errors</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="list-disc list-inside text-sm text-destructive">
                {errors.map((error, i) => (
                  <li key={i}>{error}</li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="basic" className="w-full">
          <TabsList className="grid w-full grid-cols-5">
            <TabsTrigger value="basic">Basic</TabsTrigger>
            <TabsTrigger value="types">Types</TabsTrigger>
            <TabsTrigger value="text">Text</TabsTrigger>
            <TabsTrigger value="visual">Visual</TabsTrigger>
            <TabsTrigger value="set">Set Info</TabsTrigger>
          </TabsList>

          {/* Basic Info Tab */}
          <TabsContent value="basic" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Type className="w-4 h-4" />
                  Basic Information
                </CardTitle>
                <CardDescription>
                  Core card properties
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="cardName">Card Name</Label>
                  <Input
                    id="cardName"
                    value={card.name}
                    onChange={(e) => updateField('name', e.target.value)}
                    placeholder="Enter card name"
                    disabled={readOnly}
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="manaCost">Mana Cost</Label>
                  <Input
                    id="manaCost"
                    value={card.manaCost}
                    onChange={(e) => updateField('manaCost', e.target.value)}
                    placeholder="{1}{W}{U} or 2UU"
                    disabled={readOnly}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use curly-brace format: {'"{1}{W}{U}"'} or {'"{2}{U}{U}"'}
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="typeLine">Type Line</Label>
                  <Input
                    id="typeLine"
                    value={card.typeLine}
                    onChange={(e) => updateField('typeLine', e.target.value)}
                    placeholder="Creature — Human Soldier"
                    disabled={readOnly}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Card Colors</Label>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_OPTIONS.map((color) => (
                      <Button
                        key={color}
                        variant={card.colors.includes(color) ? 'default' : 'outline'}
                        size="sm"
                        className={cn(
                          'gap-2',
                          card.colors.includes(color) && 
                          `bg-[${CARD_COLORS[color].hex}] hover:bg-[${CARD_COLORS[color].hex}]/90`
                        )}
                        onClick={() => toggleColor(color)}
                        disabled={readOnly}
                        style={{
                          backgroundColor: card.colors.includes(color) ? CARD_COLORS[color].hex : undefined,
                          color: color === 'white' || color === 'colorless' ? '#000' : '#fff',
                        }}
                      >
                        <span className="w-4 h-4 rounded-full border border-current flex items-center justify-center">
                          {CARD_COLORS[color].symbol}
                        </span>
                        {CARD_COLORS[color].name}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="rarity">Rarity</Label>
                  <Select
                    value={card.rarity}
                    onValueChange={(value) => updateField('rarity', value as CardRarity)}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {RARITIES.map((rarity) => (
                        <SelectItem key={rarity.value} value={rarity.value}>
                          <span className="flex items-center gap-2">
                            <span style={{ color: RARITY_COLORS[rarity.value] }}>●</span>
                            {rarity.label}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Types Tab */}
          <TabsContent value="types" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Type className="w-4 h-4" />
                  Card Types
                </CardTitle>
                <CardDescription>
                  Select one or more card types
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {CARD_TYPES.map((type) => (
                    <Button
                      key={type.value}
                      variant={card.cardTypes.includes(type.value) ? 'default' : 'outline'}
                      className="justify-start gap-2"
                      onClick={() => toggleCardType(type.value)}
                      disabled={readOnly}
                    >
                      <span className="text-lg">{type.icon}</span>
                      {type.label}
                    </Button>
                  ))}
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label htmlFor="subtypes">Subtypes</Label>
                  <Input
                    id="subtypes"
                    value={card.subtypes?.join(' ') || ''}
                    onChange={(e) => updateField('subtypes', e.target.value.split(' ').filter(Boolean))}
                    placeholder="Human Soldier (space separated)"
                    disabled={readOnly}
                  />
                </div>

                {/* Power/Toughness for creatures */}
                {card.cardTypes.includes('creature') && (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="grid gap-2">
                      <Label htmlFor="power">Power</Label>
                      <Input
                        id="power"
                        value={card.power}
                        onChange={(e) => updateField('power', e.target.value)}
                        placeholder="1"
                        disabled={readOnly}
                      />
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="toughness">Toughness</Label>
                      <Input
                        id="toughness"
                        value={card.toughness}
                        onChange={(e) => updateField('toughness', e.target.value)}
                        placeholder="1"
                        disabled={readOnly}
                      />
                    </div>
                  </div>
                )}

                {/* Loyalty for planeswalkers */}
                {card.cardTypes.includes('planeswalker') && (
                  <div className="grid gap-2">
                    <Label htmlFor="loyalty">Starting Loyalty</Label>
                    <Input
                      id="loyalty"
                      value={card.loyalty}
                      onChange={(e) => updateField('loyalty', e.target.value)}
                      placeholder="3"
                      disabled={readOnly}
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Text Tab */}
          <TabsContent value="text" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Type className="w-4 h-4" />
                  Card Text
                </CardTitle>
                <CardDescription>
                  Oracle text, flavor text, and abilities
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="oracleText">Oracle Text</Label>
                  <Textarea
                    id="oracleText"
                    value={card.oracleText}
                    onChange={(e) => updateField('oracleText', e.target.value)}
                    placeholder="Enter card abilities and rules text..."
                    rows={6}
                    disabled={readOnly}
                  />
                  <p className="text-xs text-muted-foreground">
                    Use Enter for new lines. {'{T}'} for tap, {'{Q}'} for untap, etc.
                  </p>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="flavorText">Flavor Text</Label>
                  <Textarea
                    id="flavorText"
                    value={card.flavorText}
                    onChange={(e) => updateField('flavorText', e.target.value)}
                    placeholder="Enter flavor text (optional)..."
                    rows={3}
                    disabled={readOnly}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Visual Tab */}
          <TabsContent value="visual" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Palette className="w-4 h-4" />
                  Visual Settings
                </CardTitle>
                <CardDescription>
                  Frame style, colors, and typography
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-2">
                  <Label htmlFor="frameStyle">Frame Style</Label>
                  <Select
                    value={card.frameStyle}
                    onValueChange={(value) => updateField('frameStyle', value as CardFrameStyle)}
                    disabled={readOnly}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {FRAME_STYLES.map((style) => (
                        <SelectItem key={style.value} value={style.value}>
                          {style.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label htmlFor="artUrl">Art Image URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="artUrl"
                      value={card.art.imageUrl || ''}
                      onChange={(e) => updateField('art', { ...card.art, imageUrl: e.target.value })}
                      placeholder="https://example.com/art.jpg"
                      disabled={readOnly}
                    />
                    {card.art.imageUrl && (
                      <Button
                        variant="outline"
                        size="icon"
                        onClick={() => updateField('art', { ...card.art, imageUrl: undefined })}
                        disabled={readOnly}
                      >
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label>Procedural Art Colors</Label>
                  <div className="flex flex-wrap gap-2">
                    {(['white', 'blue', 'black', 'red', 'green'] as CardColor[]).map((color) => (
                      <Button
                        key={color}
                        variant={card.art.proceduralColors?.includes(color) ? 'default' : 'outline'}
                        size="sm"
                        onClick={() => {
                          const colors = card.art.proceduralColors || [];
                          const newColors = colors.includes(color)
                            ? colors.filter(c => c !== color)
                            : [...colors, color];
                          updateField('art', { ...card.art, proceduralColors: newColors });
                        }}
                        disabled={readOnly}
                        style={{
                          backgroundColor: card.art.proceduralColors?.includes(color) ? CARD_COLORS[color].hex : undefined,
                          color: color === 'white' ? '#000' : '#fff',
                        }}
                      >
                        {CARD_COLORS[color].name}
                      </Button>
                    ))}
                  </div>
                </div>

                <Separator />

                <div className="grid gap-2">
                  <Label>Artist Credit</Label>
                  <Input
                    value={card.artist}
                    onChange={(e) => updateField('artist', e.target.value)}
                    placeholder="Artist Name"
                    disabled={readOnly}
                  />
                </div>

                <div className="grid gap-2">
                  <Label>Copyright</Label>
                  <Input
                    value={card.copyright}
                    onChange={(e) => updateField('copyright', e.target.value)}
                    placeholder="© 2024 Custom Cards"
                    disabled={readOnly}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          {/* Set Info Tab */}
          <TabsContent value="set" className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <ImageIcon className="w-4 h-4" />
                  Set Information
                </CardTitle>
                <CardDescription>
                  Custom set and collector details
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div className="grid gap-2">
                    <Label htmlFor="setCode">Set Code</Label>
                    <Input
                      id="setCode"
                      value={card.setCode}
                      onChange={(e) => updateField('setCode', e.target.value.toUpperCase())}
                      placeholder="CUS"
                      maxLength={3}
                      disabled={readOnly}
                    />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="collectorNumber">Collector Number</Label>
                    <Input
                      id="collectorNumber"
                      value={card.collectorNumber}
                      onChange={(e) => updateField('collectorNumber', e.target.value)}
                      placeholder="001"
                      disabled={readOnly}
                    />
                  </div>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="setName">Set Name</Label>
                  <Input
                    id="setName"
                    value={card.setName}
                    onChange={(e) => updateField('setName', e.target.value)}
                    placeholder="Custom"
                    disabled={readOnly}
                  />
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>

        {/* Delete Button */}
        {initialCard && (
          <div className="flex justify-end">
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={readOnly}
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Delete Card
            </Button>
          </div>
        )}
      </div>

      {/* Preview Panel */}
      <div className="lg:w-[340px] shrink-0">
        <Card className="sticky top-4">
          <CardHeader>
            <CardTitle>Card Preview</CardTitle>
            <CardDescription>
              Live preview of your card
            </CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            {/* Import dynamically to avoid SSR issues */}
            <div className="scale-[0.6] origin-top">
              {/* We use a dynamic import pattern */}
              <PreviewRenderer card={card} />
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// Preview renderer component (dynamically loaded)
function PreviewRenderer({ card }: { card: CustomCardDefinition }) {
  const [CustomCardPreview, setCustomCardPreview] = useState<React.ComponentType<{
    card: CustomCardDefinition;
    scale?: number;
    interactive?: boolean;
    className?: string;
    showBack?: boolean;
  }> | null>(null);

  useEffect(() => {
    import('@/components/custom-card-preview').then((module) => {
      setCustomCardPreview(() => module.CustomCardPreview);
    });
  }, []);

  if (!CustomCardPreview) {
    return (
      <div className="w-[312px] h-[445px] bg-muted animate-pulse rounded-lg" />
    );
  }

  return <CustomCardPreview card={card} scale={1.1} interactive />;
}

export default CustomCardEditor;
