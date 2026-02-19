'use client';

import { useState, useEffect } from 'react';
import { useGameSounds, SoundType } from '@/hooks/use-game-sounds';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Volume2, VolumeX, Music, Speaker, Play, Square } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SoundSettingsProps {
  className?: string;
}

// Sound categories for testing
const SOUND_CATEGORIES: Record<string, { label: string; sounds: { type: SoundType; label: string }[] }> = {
  'Game Actions': {
    label: 'Game Actions',
    sounds: [
      { type: 'card_cast', label: 'Card Cast' },
      { type: 'card_draw', label: 'Draw Card' },
      { type: 'land_play', label: 'Play Land' },
      { type: 'shuffle', label: 'Shuffle' },
      { type: 'tap', label: 'Tap' },
      { type: 'untap', label: 'Untap' },
    ],
  },
  'Combat': {
    label: 'Combat',
    sounds: [
      { type: 'combat_attack', label: 'Attack' },
      { type: 'combat_block', label: 'Block' },
      { type: 'damage_deal', label: 'Deal Damage' },
      { type: 'damage_take', label: 'Take Damage' },
    ],
  },
  'Spells & Effects': {
    label: 'Spells & Effects',
    sounds: [
      { type: 'spell_cast', label: 'Cast Spell' },
      { type: 'counter_spell', label: 'Counter Spell' },
      { type: 'life_change', label: 'Life Change' },
    ],
  },
  'Turn & Phase': {
    label: 'Turn & Phase',
    sounds: [
      { type: 'turn_start', label: 'Turn Start' },
      { type: 'turn_end', label: 'Turn End' },
      { type: 'phase_change', label: 'Phase Change' },
      { type: 'priority_pass', label: 'Pass Priority' },
    ],
  },
  'Game Events': {
    label: 'Game Events',
    sounds: [
      { type: 'game_win', label: 'Win' },
      { type: 'game_lose', label: 'Lose' },
      { type: 'error', label: 'Error' },
      { type: 'button_click', label: 'Button Click' },
    ],
  },
};

export function SoundSettings({ className }: SoundSettingsProps) {
  const {
    enabled,
    masterVolume,
    musicVolume,
    sfxVolume,
    setEnabled,
    setMasterVolume,
    setMusicVolume,
    setSfxVolume,
    play,
    playBackgroundMusic,
    stopBackgroundMusic,
    isMusicPlaying,
  } = useGameSounds();

  const [localMaster, setLocalMaster] = useState(masterVolume);
  const [localSfx, setLocalSfx] = useState(sfxVolume);
  const [localMusic, setLocalMusic] = useState(musicVolume);

  // Sync local state with hook state
  useEffect(() => {
    setLocalMaster(masterVolume);
  }, [masterVolume]);

  useEffect(() => {
    setLocalSfx(sfxVolume);
  }, [sfxVolume]);

  useEffect(() => {
    setLocalMusic(musicVolume);
  }, [musicVolume]);

  const handleMasterChange = (value: number[]) => {
    const vol = value[0] / 100;
    setLocalMaster(vol);
    setMasterVolume(vol);
  };

  const handleSfxChange = (value: number[]) => {
    const vol = value[0] / 100;
    setLocalSfx(vol);
    setSfxVolume(vol);
  };

  const handleMusicChange = (value: number[]) => {
    const vol = value[0] / 100;
    setLocalMusic(vol);
    setMusicVolume(vol);
  };

  const testSound = (sound: SoundType) => {
    play(sound);
  };

  const toggleMusic = () => {
    if (isMusicPlaying) {
      stopBackgroundMusic();
    } else {
      playBackgroundMusic();
    }
  };

  return (
    <div className={cn('space-y-6', className)}>
      {/* Master Toggle */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {enabled ? (
            <Volume2 className="w-5 h-5" />
          ) : (
            <VolumeX className="w-5 h-5" />
          )}
          <span className="font-medium">Sound Effects</span>
        </div>
        <Button
          variant={enabled ? 'default' : 'outline'}
          size="sm"
          onClick={() => setEnabled(!enabled)}
        >
          {enabled ? 'On' : 'Off'}
        </Button>
      </div>

      {enabled && (
        <>
          {/* Master Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Speaker className="w-4 h-4" />
                <span className="text-sm">Master Volume</span>
              </div>
              <span className="text-sm text-muted-foreground">{Math.round(localMaster * 100)}%</span>
            </div>
            <Slider
              value={[localMaster * 100]}
              onValueChange={handleMasterChange}
              max={100}
              step={1}
              className="w-full"
            />
          </div>

          {/* SFX Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Volume2 className="w-4 h-4" />
                <span className="text-sm">Sound Effects</span>
              </div>
              <span className="text-sm text-muted-foreground">{Math.round(localSfx * 100)}%</span>
            </div>
            <Slider
              value={[localSfx * 100]}
              onValueChange={handleSfxChange}
              max={100}
              step={1}
              className="w-full"
            />
          </div>

          {/* Music Volume */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Music className="w-4 h-4" />
                <span className="text-sm">Music</span>
              </div>
              <span className="text-sm text-muted-foreground">{Math.round(localMusic * 100)}%</span>
            </div>
            <Slider
              value={[localMusic * 100]}
              onValueChange={handleMusicChange}
              max={100}
              step={1}
              className="w-full"
            />
          </div>

          {/* Background Music Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {isMusicPlaying ? (
                <Play className="w-4 h-4" />
              ) : (
                <Square className="w-4 h-4" />
              )}
              <span className="text-sm">Background Music</span>
            </div>
            <Button
              variant={isMusicPlaying ? 'default' : 'outline'}
              size="sm"
              onClick={toggleMusic}
            >
              {isMusicPlaying ? 'Stop' : 'Play'}
            </Button>
          </div>

          {/* Test Sounds by Category */}
          <div className="space-y-4">
            <span className="text-sm font-medium">Test Sounds</span>
            {Object.entries(SOUND_CATEGORIES).map(([key, category]) => (
              <div key={key} className="space-y-2">
                <span className="text-xs text-muted-foreground">{category.label}</span>
                <div className="flex flex-wrap gap-2">
                  {category.sounds.map((sound) => (
                    <Button
                      key={sound.type}
                      variant="outline"
                      size="sm"
                      onClick={() => testSound(sound.type)}
                    >
                      {sound.label}
                    </Button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}