'use client';

import { useState, useEffect } from 'react';
import { useGameSounds, SoundType } from '@/hooks/use-game-sounds';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Volume2, VolumeX, Music, Speaker } from 'lucide-react';
import { cn } from '@/lib/utils';

interface SoundSettingsProps {
  className?: string;
}

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

          {/* Test Sounds */}
          <div className="space-y-2">
            <span className="text-sm">Test Sounds</span>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => testSound('card_cast')}
              >
                Card Cast
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testSound('combat_attack')}
              >
                Attack
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testSound('land_play')}
              >
                Land Play
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testSound('turn_start')}
              >
                Turn Start
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testSound('game_win')}
              >
                Win
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => testSound('game_lose')}
              >
                Lose
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
