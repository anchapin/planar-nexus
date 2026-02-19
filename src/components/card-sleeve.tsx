'use client';

import { useState, useEffect, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Upload, Check, Palette, Image, RotateCcw, Eye, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

// Sleeve patterns
export type SleevePattern = 'gradient' | 'stripes' | 'dots' | 'diamond' | 'swirl' | 'solid';

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
  | 'gold'
  | 'silver'
  | 'holographic'
  | 'custom';

export interface CardSleeve {
  type: SleeveType;
  name: string;
  pattern?: SleevePattern;
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
  { type: 'gold', name: 'Golden', pattern: 'swirl', primaryColor: '#fbbf24', secondaryColor: '#d97706' },
  { type: 'silver', name: 'Silver', pattern: 'diamond', primaryColor: '#9ca3af', secondaryColor: '#6b7280' },
  { type: 'holographic', name: 'Holographic', pattern: 'swirl', primaryColor: '#ec4899', secondaryColor: '#8b5cf6' },
];

// Default playmat options
export type PlaymatType = 
  | 'default' 
  | 'wood' 
  | 'stone' 
  | 'grass' 
  | 'magic' 
  | 'arena'
  | 'space'
  | 'ocean'
  | 'custom';

export interface Playmat {
  type: PlaymatType;
  name: string;
  backgroundImage?: string;
  primaryColor?: string;
  secondaryColor?: string;
  borderColor?: string;
  pattern?: SleevePattern;
}

export const DEFAULT_PLAYMATS: Playmat[] = [
  { type: 'default', name: 'Classic', primaryColor: '#1f2937', borderColor: '#374151' },
  { type: 'wood', name: 'Wooden Table', primaryColor: '#78350f', secondaryColor: '#451a03', borderColor: '#451a03', pattern: 'stripes' },
  { type: 'stone', name: 'Stone Floor', primaryColor: '#4b5563', secondaryColor: '#374151', borderColor: '#1f2937', pattern: 'diamond' },
  { type: 'grass', name: 'Forest Ground', primaryColor: '#166534', secondaryColor: '#14532d', borderColor: '#14532d', pattern: 'dots' },
  { type: 'magic', name: 'Magic Arena', primaryColor: '#312e81', secondaryColor: '#1e1b4b', borderColor: '#1e1b4b', pattern: 'swirl' },
  { type: 'arena', name: 'Colosseum', primaryColor: '#713f12', secondaryColor: '#451a03', borderColor: '#451a03', pattern: 'gradient' },
  { type: 'space', name: 'Cosmic', primaryColor: '#0f172a', secondaryColor: '#1e1b4b', borderColor: '#312e81', pattern: 'swirl' },
  { type: 'ocean', name: 'Ocean Depths', primaryColor: '#0c4a6e', secondaryColor: '#164e63', borderColor: '#155e75', pattern: 'gradient' },
];

// Customization settings interface
export interface CustomizationSettings {
  sleeve: CardSleeve;
  playmat: Playmat;
}

// Generate pattern background
function getPatternBackground(pattern: SleevePattern, primaryColor: string, secondaryColor: string): string {
  switch (pattern) {
    case 'gradient':
      return `linear-gradient(135deg, ${primaryColor}, ${secondaryColor})`;
    case 'stripes':
      return `repeating-linear-gradient(45deg, ${primaryColor}, ${primaryColor} 10px, ${secondaryColor} 10px, ${secondaryColor} 20px)`;
    case 'dots':
      return `radial-gradient(circle, ${secondaryColor} 2px, ${primaryColor} 2px)`;
    case 'diamond':
      return `linear-gradient(45deg, ${primaryColor} 25%, ${secondaryColor} 25%, ${secondaryColor} 50%, ${primaryColor} 50%, ${primaryColor} 75%, ${secondaryColor} 75%)`;
    case 'swirl':
      return `conic-gradient(from 0deg, ${primaryColor}, ${secondaryColor}, ${primaryColor})`;
    case 'solid':
    default:
      return primaryColor;
  }
}

// Component for selecting a card sleeve
interface SleeveSelectorProps {
  selectedSleeve: CardSleeve;
  onSelect: (sleeve: CardSleeve) => void;
  className?: string;
}

export function SleeveSelector({ selectedSleeve, onSelect, className }: SleeveSelectorProps) {
  return (
    <div className={cn('grid grid-cols-3 sm:grid-cols-4 gap-2', className)}>
      {DEFAULT_SLEEVES.map((sleeve) => (
        <button
          key={sleeve.type}
          onClick={() => onSelect(sleeve)}
          className={cn(
            'relative aspect-[3/4] rounded-md overflow-hidden border-2 transition-all hover:scale-105',
            selectedSleeve.type === sleeve.type 
              ? 'border-primary ring-2 ring-primary/50' 
              : 'border-border hover:border-primary/50'
          )}
          title={sleeve.name}
        >
          <div
            className="absolute inset-0"
            style={{
              background: getPatternBackground(sleeve.pattern || 'gradient', sleeve.primaryColor!, sleeve.secondaryColor!),
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
    <div className={cn('grid grid-cols-2 sm:grid-cols-3 gap-2', className)}>
      {DEFAULT_PLAYMATS.map((playmat) => (
        <button
          key={playmat.type}
          onClick={() => onSelect(playmat)}
          className={cn(
            'relative aspect-video rounded-md overflow-hidden border-2 transition-all hover:scale-105',
            selectedPlaymat.type === playmat.type 
              ? 'border-primary ring-2 ring-primary/50' 
              : 'border-border hover:border-primary/50'
          )}
          title={playmat.name}
        >
          <div
            className="absolute inset-0"
            style={{
              background: playmat.pattern 
                ? getPatternBackground(playmat.pattern, playmat.primaryColor!, playmat.secondaryColor || playmat.primaryColor!)
                : playmat.primaryColor,
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
  size?: 'sm' | 'md' | 'lg';
}

export function SleevePreview({ sleeve, className, size = 'md' }: SleevePreviewProps) {
  const sizeClasses = {
    sm: 'w-12 h-16',
    md: 'w-16 h-24',
    lg: 'w-24 h-36',
  };

  return (
    <div
      className={cn(
        'rounded-md overflow-hidden shadow-lg relative',
        sizeClasses[size],
        className
      )}
      style={{
        background: sleeve.type === 'custom' && sleeve.customImage
          ? `url(${sleeve.customImage}) center/cover`
          : getPatternBackground(sleeve.pattern || 'gradient', sleeve.primaryColor!, sleeve.secondaryColor!),
      }}
    >
      {/* Card back design */}
      <div className="w-full h-full flex items-center justify-center">
        <div className={cn(
          'border-2 border-white/30 rounded-sm flex items-center justify-center',
          size === 'sm' ? 'w-8 h-12' : size === 'md' ? 'w-12 h-20' : 'w-18 h-28'
        )}>
          <Sparkles className={cn(
            'text-white/50',
            size === 'sm' ? 'w-4 h-4' : size === 'md' ? 'w-6 h-6' : 'w-8 h-8'
          )} />
        </div>
      </div>
    </div>
  );
}

// Playmat preview component
interface PlaymatPreviewProps {
  playmat: Playmat;
  className?: string;
}

export function PlaymatPreview({ playmat, className }: PlaymatPreviewProps) {
  return (
    <div
      className={cn(
        'w-full aspect-video rounded-lg overflow-hidden shadow-lg relative',
        className
      )}
      style={{
        background: playmat.type === 'custom' && playmat.backgroundImage
          ? `url(${playmat.backgroundImage}) center/cover`
          : playmat.pattern
            ? getPatternBackground(playmat.pattern, playmat.primaryColor!, playmat.secondaryColor || playmat.primaryColor!)
            : playmat.primaryColor,
        border: `8px solid ${playmat.borderColor}`,
      }}
    >
      {/* Playmat zones visualization */}
      <div className="absolute inset-4 flex flex-col justify-between">
        <div className="flex justify-center">
          <div className="w-16 h-10 bg-white/10 rounded border border-white/20" />
        </div>
        <div className="flex justify-center gap-8">
          <div className="w-12 h-16 bg-white/10 rounded border border-white/20" />
          <div className="w-12 h-16 bg-white/10 rounded border border-white/20" />
        </div>
        <div className="flex justify-center">
          <div className="w-16 h-10 bg-white/10 rounded border border-white/20" />
        </div>
      </div>
    </div>
  );
}

// Preview Dialog Component
interface PreviewDialogProps {
  settings: CustomizationSettings;
  trigger?: React.ReactNode;
}

function PreviewDialog({ settings, trigger }: PreviewDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Eye className="w-4 h-4 mr-2" />
            Preview
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Preview Customization</DialogTitle>
        </DialogHeader>
        <div className="space-y-6">
          {/* Sleeve Preview */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Card Sleeve</h4>
            <div className="flex items-center gap-4 p-4 bg-muted rounded-lg">
              <SleevePreview sleeve={settings.sleeve} size="lg" />
              <div className="flex-1">
                <p className="font-medium">{settings.sleeve.name}</p>
                <p className="text-sm text-muted-foreground">
                  {settings.sleeve.type === 'custom' ? 'Custom upload' : 'Preset sleeve'}
                </p>
              </div>
            </div>
          </div>

          {/* Playmat Preview */}
          <div className="space-y-2">
            <h4 className="text-sm font-medium">Playmat</h4>
            <PlaymatPreview playmat={settings.playmat} />
            <p className="text-sm text-muted-foreground">{settings.playmat.name}</p>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// Main customization panel component
interface CustomizationPanelProps {
  settings: CustomizationSettings;
  onSettingsChange: (settings: CustomizationSettings) => void;
  className?: string;
  showPreview?: boolean;
}

export function CustomizationPanel({ 
  settings, 
  onSettingsChange,
  className,
  showPreview = true,
}: CustomizationPanelProps) {
  const [customSleeveName, setCustomSleeveName] = useState('');
  const [pendingSettings, setPendingSettings] = useState<CustomizationSettings>(settings);

  // Sync pending settings with actual settings
  useEffect(() => {
    setPendingSettings(settings);
  }, [settings]);

  const handleSleeveSelect = (sleeve: CardSleeve) => {
    const newSettings = { ...pendingSettings, sleeve };
    setPendingSettings(newSettings);
    onSettingsChange(newSettings);
  };

  const handlePlaymatSelect = (playmat: Playmat) => {
    const newSettings = { ...pendingSettings, playmat };
    setPendingSettings(newSettings);
    onSettingsChange(newSettings);
  };

  const handleImageUpload = useCallback((event: React.ChangeEvent<HTMLInputElement>, type: 'sleeve' | 'playmat') => {
    const file = event.target.files?.[0];
    if (file) {
      // Check file size (limit to 5MB)
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }

      const reader = new FileReader();
      reader.onloadend = () => {
        const imageData = reader.result as string;
        if (type === 'sleeve') {
          const newSettings = {
            ...pendingSettings,
            sleeve: {
              type: 'custom' as SleeveType,
              name: customSleeveName || 'Custom Sleeve',
              customImage: imageData,
              primaryColor: '#6366f1',
              secondaryColor: '#8b5cf6',
              pattern: 'gradient' as SleevePattern,
            },
          };
          setPendingSettings(newSettings);
          onSettingsChange(newSettings);
        } else {
          const newSettings = {
            ...pendingSettings,
            playmat: {
              type: 'custom' as PlaymatType,
              name: 'Custom Playmat',
              backgroundImage: imageData,
              primaryColor: '#1f2937',
              borderColor: '#374151',
            },
          };
          setPendingSettings(newSettings);
          onSettingsChange(newSettings);
        }
      };
      reader.readAsDataURL(file);
    }
  }, [pendingSettings, onSettingsChange, customSleeveName]);

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Palette className="w-5 h-5" />
            Card Customization
          </CardTitle>
          {showPreview && (
            <PreviewDialog settings={pendingSettings} />
          )}
        </div>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="sleeves" className="w-full">
          <TabsList className="w-full">
            <TabsTrigger value="sleeves" className="flex-1">Card Sleeves</TabsTrigger>
            <TabsTrigger value="playmat" className="flex-1">Playmat</TabsTrigger>
          </TabsList>
          
          <TabsContent value="sleeves" className="space-y-4">
            <SleeveSelector
              selectedSleeve={pendingSettings.sleeve}
              onSelect={handleSleeveSelect}
            />
            
            <div className="border-t pt-4">
              <Label className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4" />
                Custom Sleeve
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Upload a custom image (max 5MB, recommended: 300x420px)
              </p>
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
              selectedPlaymat={pendingSettings.playmat}
              onSelect={handlePlaymatSelect}
            />
            
            <div className="border-t pt-4">
              <Label className="flex items-center gap-2 mb-2">
                <Upload className="w-4 h-4" />
                Custom Playmat
              </Label>
              <p className="text-xs text-muted-foreground mb-2">
                Upload a custom image (max 5MB, recommended: 1920x1080px)
              </p>
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

export function useCustomization({ storageKey = 'planar-nexus-customization' }: UseCustomizationOptions = {}): UseCustomizationReturn {
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

// Full customization page component
interface CustomizationPageProps {
  className?: string;
}

export function CustomizationPage({ className }: CustomizationPageProps) {
  const { settings, updateSettings, resetToDefaults } = useCustomization();

  return (
    <div className={cn('space-y-6', className)}>
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">Customization</h2>
        <Button variant="outline" size="sm" onClick={resetToDefaults}>
          <RotateCcw className="w-4 h-4 mr-2" />
          Reset to Defaults
        </Button>
      </div>
      
      <CustomizationPanel
        settings={settings}
        onSettingsChange={updateSettings}
        showPreview={true}
      />
    </div>
  );
}