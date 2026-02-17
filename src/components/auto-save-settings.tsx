/**
 * @fileOverview Auto-save settings component
 * 
 * Issue #269: Auto-save functionality for game states
 * 
 * Provides:
 * - UI for configuring auto-save settings
 * - Toggle switches for triggers
 * - Configuration options
 */

"use client";

import { useState, useEffect } from "react";
import { Save, Clock, RotateCcw, Bell, Trash2, Check, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  getAutoSaveConfig,
  setAutoSaveConfig,
  resetAutoSaveConfig,
  DEFAULT_AUTO_SAVE_CONFIG,
  type AutoSaveTrigger,
  type AutoSaveConfig,
} from "@/lib/auto-save-config";
import { savedGamesManager } from "@/lib/saved-games";
import { useToast } from "@/hooks/use-toast";

/**
 * Trigger configuration for UI display
 */
interface TriggerConfig {
  id: AutoSaveTrigger;
  label: string;
  description: string;
  recommended: boolean;
}

const TRIGGER_CONFIGS: TriggerConfig[] = [
  {
    id: 'end_of_turn',
    label: 'End of Turn',
    description: 'Auto-save when a turn ends',
    recommended: true,
  },
  {
    id: 'after_combat',
    label: 'After Combat',
    description: 'Auto-save after combat phase completes',
    recommended: true,
  },
  {
    id: 'pass_priority',
    label: 'Pass Priority',
    description: 'Auto-save when passing priority',
    recommended: true,
  },
  {
    id: 'before_modal',
    label: 'Before Modal',
    description: 'Auto-save before showing modal dialogs',
    recommended: true,
  },
  {
    id: 'card_played',
    label: 'Card Played',
    description: 'Auto-save after playing a card',
    recommended: false,
  },
  {
    id: 'spell_resolved',
    label: 'Spell Resolved',
    description: 'Auto-save after a spell resolves',
    recommended: false,
  },
  {
    id: 'player_gained_life',
    label: 'Life Gain',
    description: 'Auto-save after a player gains life',
    recommended: false,
  },
  {
    id: 'creature_died',
    label: 'Creature Died',
    description: 'Auto-save after a creature dies',
    recommended: false,
  },
];

export function AutoSaveSettings() {
  const { toast } = useToast();
  const [config, setConfigState] = useState<AutoSaveConfig>(DEFAULT_AUTO_SAVE_CONFIG);
  const [autoSaveCount, setAutoSaveCount] = useState(0);
  const [isResetting, setIsResetting] = useState(false);

  // Load config on mount
  useEffect(() => {
    setConfigState(getAutoSaveConfig());
    updateAutoSaveCount();
  }, []);

  // Update config in localStorage
  const updateConfig = (updates: Partial<AutoSaveConfig>) => {
    const newConfig = { ...config, ...updates };
    setAutoSaveConfig(updates);
    setConfigState(newConfig);
  };

  // Toggle a trigger
  const toggleTrigger = (trigger: AutoSaveTrigger) => {
    const triggers = config.triggers.includes(trigger)
      ? config.triggers.filter(t => t !== trigger)
      : [...config.triggers, trigger];
    updateConfig({ triggers });
  };

  // Update auto-save count
  const updateAutoSaveCount = () => {
    const autoSaves = savedGamesManager.getAutoSaves();
    setAutoSaveCount(autoSaves.length);
  };

  // Clear all auto-saves
  const handleClearAutoSaves = () => {
    const autoSaves = savedGamesManager.getAutoSaves();
    let deleted = 0;
    
    for (const save of autoSaves) {
      if (savedGamesManager.deleteGame(save.id)) {
        deleted++;
      }
    }
    
    updateAutoSaveCount();
    toast({
      title: 'Auto-Saves Cleared',
      description: `Deleted ${deleted} auto-save${deleted !== 1 ? 's' : ''}.`,
    });
  };

  // Reset to defaults
  const handleReset = () => {
    setIsResetting(true);
    resetAutoSaveConfig();
    setConfigState(DEFAULT_AUTO_SAVE_CONFIG);
    toast({
      title: 'Settings Reset',
      description: 'Auto-save settings have been reset to defaults.',
    });
    setIsResetting(false);
  };

  return (
    <div className="space-y-6">
      {/* Main Toggle */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Save className="h-5 w-5" />
            Auto-Save
          </CardTitle>
          <CardDescription>
            Automatically save your game progress at key moments
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-save-enabled">Enable Auto-Save</Label>
              <p className="text-sm text-muted-foreground">
                Automatically save game state during play
              </p>
            </div>
            <Switch
              id="auto-save-enabled"
              checked={config.enabled}
              onCheckedChange={(checked) => updateConfig({ enabled: checked })}
            />
          </div>

          <Separator />

          {/* Status */}
          <div className="flex items-center gap-4 text-sm">
            <span className="text-muted-foreground">
              Current auto-saves: <strong>{autoSaveCount}</strong> / {config.maxAutoSaves}
            </span>
            {autoSaveCount > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={handleClearAutoSaves}
              >
                <Trash2 className="h-4 w-4 mr-2" />
                Clear Auto-Saves
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Trigger Selection */}
      <Card>
        <CardHeader>
          <CardTitle>Save Triggers</CardTitle>
          <CardDescription>
            Choose when auto-saves should be triggered
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3">
            {TRIGGER_CONFIGS.map((trigger) => {
              const isEnabled = config.triggers.includes(trigger.id);
              
              return (
                <div
                  key={trigger.id}
                  className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <Switch
                      id={`trigger-${trigger.id}`}
                      checked={isEnabled}
                      onCheckedChange={() => toggleTrigger(trigger.id)}
                      disabled={!config.enabled}
                    />
                    <div>
                      <Label
                        htmlFor={`trigger-${trigger.id}`}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        {trigger.label}
                        {trigger.recommended && (
                          <Badge variant="secondary" className="text-xs bg-green-500/20 text-green-500">
                            <Check className="h-3 w-3 mr-1" />
                            Recommended
                          </Badge>
                        )}
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        {trigger.description}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <Separator />

          {/* Quick presets */}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateConfig({
                triggers: TRIGGER_CONFIGS.filter(t => t.recommended).map(t => t.id),
              })}
            >
              Use Recommended
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateConfig({ triggers: [] })}
            >
              Disable All
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => updateConfig({
                triggers: TRIGGER_CONFIGS.map(t => t.id),
              })}
            >
              Enable All
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Advanced Settings */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Advanced Settings
          </CardTitle>
          <CardDescription>
            Fine-tune auto-save behavior
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Max Auto-Saves */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Maximum Auto-Saves</Label>
              <p className="text-sm text-muted-foreground">
                Number of auto-saves to keep (oldest will be deleted)
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateConfig({ maxAutoSaves: Math.max(1, config.maxAutoSaves - 1) })}
              >
                -
              </Button>
              <span className="w-8 text-center font-mono">{config.maxAutoSaves}</span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => updateConfig({ maxAutoSaves: Math.min(10, config.maxAutoSaves + 1) })}
              >
                +
              </Button>
            </div>
          </div>

          <Separator />

          {/* Slot Rotation */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="slot-rotation">Slot Rotation</Label>
              <p className="text-sm text-muted-foreground">
                Reuse auto-save slots in a circular buffer
              </p>
            </div>
            <Switch
              id="slot-rotation"
              checked={config.useSlotRotation}
              onCheckedChange={(checked) => updateConfig({ useSlotRotation: checked })}
            />
          </div>

          <Separator />

          {/* Visual Indicator */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="show-indicator">Visual Indicator</Label>
              <p className="text-sm text-muted-foreground">
                Show toast notifications when auto-saving
              </p>
            </div>
            <Switch
              id="show-indicator"
              checked={config.showIndicator}
              onCheckedChange={(checked) => updateConfig({ showIndicator: checked })}
            />
          </div>

          <Separator />

          {/* Sound Effect */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="play-sound" className="flex items-center gap-2">
                <Bell className="h-4 w-4" />
                Sound Effect
              </Label>
              <p className="text-sm text-muted-foreground">
                Play a sound when auto-saving
              </p>
            </div>
            <Switch
              id="play-sound"
              checked={config.playSound}
              onCheckedChange={(checked) => updateConfig({ playSound: checked })}
            />
          </div>

          <Separator />

          {/* Auto Cleanup */}
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="auto-cleanup" className="flex items-center gap-2">
                <RotateCcw className="h-4 w-4" />
                Auto Cleanup
              </Label>
              <p className="text-sm text-muted-foreground">
                Automatically remove old auto-saves when game ends
              </p>
            </div>
            <Switch
              id="auto-cleanup"
              checked={config.autoCleanup}
              onCheckedChange={(checked) => updateConfig({ autoCleanup: checked })}
            />
          </div>

          <Separator />

          {/* Periodic Save */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label htmlFor="periodic-save">Periodic Auto-Save</Label>
                <p className="text-sm text-muted-foreground">
                  Save automatically at regular intervals
                </p>
              </div>
              <Switch
                id="periodic-save"
                checked={config.enablePeriodic}
                onCheckedChange={(checked) => updateConfig({ enablePeriodic: checked })}
              />
            </div>
            
            {config.enablePeriodic && (
              <div className="flex items-center gap-2 pl-4">
                <Label htmlFor="periodic-interval" className="text-sm">
                  Interval:
                </Label>
                <select
                  id="periodic-interval"
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm"
                  value={config.periodicIntervalMs || 300000}
                  onChange={(e) => updateConfig({ periodicIntervalMs: parseInt(e.target.value) })}
                >
                  <option value={60000}>1 minute</option>
                  <option value={180000}>3 minutes</option>
                  <option value={300000}>5 minutes</option>
                  <option value={600000}>10 minutes</option>
                </select>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Info Alert */}
      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>About Auto-Save</AlertTitle>
        <AlertDescription>
          Auto-saves are stored locally in your browser. They are separate from manual saves
          and can be managed independently. Auto-saves use a rotating slot system to prevent
          excessive storage usage.
        </AlertDescription>
      </Alert>

      {/* Reset Button */}
      <div className="flex justify-end">
        <Button
          variant="outline"
          onClick={handleReset}
          disabled={isResetting}
        >
          <RotateCcw className={cn("mr-2 h-4 w-4", isResetting && "animate-spin")} />
          Reset to Defaults
        </Button>
      </div>
    </div>
  );
}

// Helper for cn import
function cn(...classes: (string | undefined | null | false)[]) {
  return classes.filter(Boolean).join(' ');
}
