'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Upload, Check, Palette, Image, X } from 'lucide-react';
import { cn } from '@/lib/utils';

// Default sleeve options
export type SleeveType = 
  | 'default' 
  | 'blue' 
  | 'red' 
  | 'green' 
  | 'black' 
  | 'white' 
  | 'purple' 
  | 'orange'
  | 'custom';

export interface CardSleeve {
  type: SleeveType;
  name: string;
  pattern?: string;
  primaryColor?: string;
  secondaryColor?: string;
  customImage?: string;
}

export const DEFAULT_SLEEVES: CardSleeve[] = [
  { type: 'default', name: 'Default', pattern: 'gradient', primaryColor: '#6366f1', secondaryColor: '#8b5cf6' },
  { type: 'blue', name: 'Ocean Blue', pattern: 'gradient', primaryColor: '#3b82f6', secondaryColor: '#1d4ed8' },
  { type: 'red', name: 'Ruby Red', pattern: 'gradient', primaryColor: '#ef4444', secondaryColor: '#dc2626' },
  { type: 'green', name: 'Forest Green', pattern: 'gradient', primaryColor: '#22c55e', secondaryColor: '#16a34a' },
  { type: 'black', name: 'Midnight', pattern: 'gradient', primaryColor: '#374151', secondaryColor: '#1f2937' },
  { type: 'white', name: 'Snow White', pattern: 'gradient', primaryColor: '#f9fafb', secondaryColor: '#e5e7eb' },
  { type: 'purple', name: 'Royal Purple', pattern: 'gradient', primaryColor: '#a855f7', secondaryColor: '#7c3aed' },
  { type: 'orange', name: 'Sunset Orange', pattern: 'gradient', primaryColor: '#f97316', secondaryColor: '#ea580c' },
];

// Default playmat options
export type PlaymatType = 
  | 'default' 
  | 'wood' 
  | 'stone' 
  | 'grass' 
  | 'magic' 
  | 'arena'
  | 'custom';

export interface Playmat {
  type: PlaymatType;
  name: string;
  backgroundImage?: string;
  primaryColor?: string;
  borderColor?: string;
}

export const DEFAULT_PLAYMATS: Playmat[] = [
  { type: 'default', name: 'Classic', primaryColor: '#1f2937', borderColor: '#374151' },
  { type: 'wood', name: 'Wooden Table', primaryColor: '#78350f', borderColor: '#451a03' },
  { type: 'stone', name: 'Stone Floor', primaryColor: '#4b5563', borderColor: '#1f2937' },
  { type: 'grass', name: 'Forest Ground', primaryColor: '#166534', borderColor: '#14532d' },
  { type: 'magic', name: 'Magic Arena', primaryColor: '#312e81', borderColor: '#1e1b4b' },
  { type: 'arena', name: 'Colosseum', primaryColor: '#713f12', borderColor: '#451a03' },
];

// Customization settings interface
export interface CustomizationSettings {
  sleeve: CardSleeve;
  playmat: Playmat;
}

// Component for selecting a card sleeve
interface SleeveSelectorProps {
  selectedSleeve: CardSleeve;
  onSelect: (sleeve: CardSleeve) => void;
  className?: string;
}

export function SleeveSelector({ selectedSleeve, onSelect, className }: SleeveSelectorProps) {
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {DEFAULT_SLEEVES.map((sleeve) => (
        <button
          key={sleeve.type}
          onClick={() => onSelect(sleeve)}
          className={cn(
            'relative aspect-[3/4] rounded-md overflow-hidden border-2 transition-all',
            selectedSleeve.type === sleeve.type 
              ? 'border-primary ring-2 ring-primary/50' 
              : 'border-border hover:border-primary/50'
          )}
          title={sleeve.name}
        >
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(135deg, ${sleeve.primaryColor}, ${sleeve.secondaryColor})`,
            }}
          />
          {selectedSleeve.type === sleeve.type && (
            <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
              <Check className="w-3 h-3 text-primary-foreground" />
            </div>
          )}
          <span className="absolute bottom-1 left-1 right-1 text-[10px] font-medium text-white text-center drop-shadow-md">
            {sleeve.name}
          </span>
        </button>
      ))}
    </div>
  );
}

// Component for selecting a playmat
interface PlaymatSelectorProps {
  selectedPlaymat: Playmat;
  onSelect: (playmat: Playmat) => void;
  className?: string;
}

export function PlaymatSelector({ selectedPlaymat, onSelect, className }: PlaymatSelectorProps) {
  return (
    <div className={cn('grid grid-cols-3 gap-2', className)}>
      {DEFAULT_PLAYMATS.map((playmat) => (
        <button
          key={playmat.type}
          onClick={() => onSelect(playmat)}
          className={cn(
            'relative aspect-video rounded-md overflow-hidden border-2 transition-all',
            selectedPlaymat.type === playmat.type 
              ? 'border-primary ring-2 ring-primary/50' 
              : 'border-border hover:border-primary/50'
          )}
          title={playmat.name}
        >
          <div
            className="absolute inset-0"
            style={{
              backgroundColor: playmat.primaryColor,
              border: `4px solid ${playmat.borderColor}`,
            }}
          />
          {selectedPlaymat.type === playmat.type && (
            <div className="absolute top-1 right-1 bg-primary rounded-full p-0.5">
              <Check className="w-3 h-3 text-primary-foreground" />
            </div>
          )}
          <span className="absolute bottom-1 left-1 right-1 text-[10px] font-medium text-white text-center drop-shadow-md">
            {playmat.name}
          </span>
        </button>
      ))}
    </div>
  );
}

// Card sleeve preview component
interface SleevePreviewProps {
  sleeve: CardSleeve;
  className?: string;
}

export function SleevePreview({ sleeve, className }: SleevePreviewProps) {
  return (
    <div
      className={cn(
        'w-16 h-24 rounded-md overflow-hidden shadow-lg',
        className
      )}
      style={{
        background: sleeve.type === 'custom' && sleeve.customImage
          ? `url(${sleeve.customImage}) center/cover`
          : `linear-gradient(135deg, ${sleeve.primaryColor}, ${sleeve.secondaryColor})`,
      }}
    >
      {/* Card back design */}
      <div className="w-full h-full flex items-center justify-center">
        <div className="w-12 h-20 border-2 border-white/30 rounded-sm" />
      </div>
    </div>
  );
}

// Main customization panel component
interface CustomizationPanelProps {
  settings: CustomizationSettings;
  onSettingsChange: (settings: CustomizationSettings) => void;
  className?: string;
}

export function CustomizationPanel({ 
  settings, 
  onSettingsChange,
  className 
}: CustomizationPanelProps) {
  const [customSleeveName, setCustomSleeveName] = useState('');
  const [customImage, setCustomImage] = useState<string | null>(null);

  const handleSleeveSelect = (sleeve: CardSleeve) => {
    onSettingsChange({ ...settings, sleeve });
  };

  const handlePlaymatSelect = (playmat: Playmat) => {
    onSettingsChange({ ...settings, playmat });
  };

  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>, type: 'sleeve' | 'playmat') => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        const imageData = reader.result as string;
        if (type === 'sleeve') {
          onSettingsChange({
            ...settings,
            sleeve: {
              type: 'custom',
              name: customSleeveName || 'Custom Sleeve',
              customImage: imageData,
              primaryColor: '#6366f1',
              secondaryColor: '#8b5cf6',
            },
          });
        } else {
          onSettingsChange({
            ...settings,
            playmat: {
              type: 'custom',
              name: 'Custom Playmat',
              backgroundImage: imageData,
              primaryColor: '#1f2937',
              borderColor: '#374151',
            },
          });
        }
      };
      reader.readAsDataURL(file);
    }
  }, [settings, onSettingsChange, customSleeveName]);

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Palette className="w-5 h-5" />
          Card Customization
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="sleeves" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="sleeves" className="flex-1">Card Sleeves</TabsTrigger>
            <TabsTrigger value="playmat" className="flex-1">Playmat</TabsTrigger>
          </TabsList>
          
          <TabsContent value="sleeves" className="space-y-4">
            <SleeveSelector
              selectedSleeve={settings.sleeve}
              onSelect={handleSleeveSelect}
            />
            
            <div className="border-t pt-4">
              <Label className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4" />
                Custom Sleeve
              </Label>
              <div className="flex gap-2">
                <Input
                  placeholder="Custom sleeve name"
                  value={customSleeveName}
                  onChange={(e) => setCustomSleeveName(e.target.value)}
                  className="flex-1"
                />
                <Label className="cursor-pointer">
                  <Input
                    type="file"
                    accept="image/*"
                    className="hidden"
                    onChange={(e) => handleImageUpload(e, 'sleeve')}
                  />
                  <Button variant="outline" size="sm" asChild>
                    <span><Image className="w-4 h-4 mr-1" /> Upload</span>
                  </Button>
                </Label>
              </div>
            </div>
          </TabsContent>
          
          <TabsContent value="playmat" className="space-y-4">
            <PlaymatSelector
              selectedPlaymat={settings.playmat}
              onSelect={handlePlaymatSelect}
            />
            
            <div className="border-t pt-4">
              <Label className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4" />
                Custom Playmat
              </Label>
              <Label className="cursor-pointer">
                <Input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => handleImageUpload(e, 'playmat')}
                />
                <Button variant="outline" size="sm" asChild>
                  <span><Image className="w-4 h-4 mr-1" /> Upload Image</span>
                </Button>
              </Label>
            </div>
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}

// Hook for managing customization settings with localStorage persistence
interface UseCustomizationOptions {
  storageKey?: string;
}

interface UseCustomizationReturn {
  settings: CustomizationSettings;
  updateSettings: (settings: CustomizationSettings) => void;
  resetToDefaults: () => void;
}

const DEFAULT_SETTINGS: CustomizationSettings = {
  sleeve: DEFAULT_SLEEVES[0],
  playmat: DEFAULT_PLAYMATS[0],
};

export function useCustomization({ storageKey = 'card-customization' }: UseCustomizationOptions = {}): UseCustomizationReturn {
  const [settings, setSettings] = useState<CustomizationSettings>(DEFAULT_SETTINGS);

  // Load settings from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setSettings({ ...DEFAULT_SETTINGS, ...parsed });
      } catch (e) {
        console.error('Failed to parse customization settings:', e);
      }
    }
  }, [storageKey]);

  // Save settings to localStorage when changed
  const updateSettings = useCallback((newSettings: CustomizationSettings) => {
    setSettings(newSettings);
    localStorage.setItem(storageKey, JSON.stringify(newSettings));
  }, [storageKey]);

  const resetToDefaults = useCallback(() => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.removeItem(storageKey);
  }, [storageKey]);

  return {
    settings,
    updateSettings,
    resetToDefaults,
  };
}
