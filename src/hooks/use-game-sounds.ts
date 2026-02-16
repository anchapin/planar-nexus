'use client';

import { useState, useCallback, useEffect, useRef } from 'react';

export type SoundType = 
  | 'card_cast'
  | 'combat_attack'
  | 'combat_block'
  | 'land_play'
  | 'turn_start'
  | 'turn_end'
  | 'game_win'
  | 'game_lose'
  | 'emote'
  | 'chat_message'
  | 'button_click'
  | 'error';

export interface SoundOptions {
  volume?: number;
  loop?: boolean;
}

interface UseGameSoundsOptions {
  enabled?: boolean;
  masterVolume?: number;
  musicVolume?: number;
  sfxVolume?: number;
}

interface UseGameSoundsReturn {
  enabled: boolean;
  masterVolume: number;
  musicVolume: number;
  sfxVolume: number;
  play: (sound: SoundType, options?: SoundOptions) => void;
  setEnabled: (enabled: boolean) => void;
  setMasterVolume: (volume: number) => void;
  setMusicVolume: (volume: number) => void;
  setSfxVolume: (volume: number) => void;
  mute: () => void;
  unmute: () => void;
}

// Sound file mappings - in a real app these would be actual audio files
// For now we use Web Audio API to generate simple tones
const SOUND_FREQUENCIES: Record<SoundType, { freq: number; duration: number; type: OscillatorType }> = {
  card_cast: { freq: 880, duration: 0.15, type: 'sine' },
  combat_attack: { freq: 220, duration: 0.3, type: 'sawtooth' },
  combat_block: { freq: 110, duration: 0.2, type: 'square' },
  land_play: { freq: 440, duration: 0.1, type: 'sine' },
  turn_start: { freq: 660, duration: 0.25, type: 'sine' },
  turn_end: { freq: 330, duration: 0.2, type: 'sine' },
  game_win: { freq: 523, duration: 0.5, type: 'sine' },
  game_lose: { freq: 262, duration: 0.5, type: 'triangle' },
  emote: { freq: 700, duration: 0.1, type: 'sine' },
  chat_message: { freq: 600, duration: 0.05, type: 'sine' },
  button_click: { freq: 500, duration: 0.05, type: 'sine' },
  error: { freq: 200, duration: 0.3, type: 'square' },
};

/**
 * Hook for managing game sounds
 */
export function useGameSounds({
  enabled = true,
  masterVolume = 0.5,
  musicVolume = 0.3,
  sfxVolume = 0.7,
}: UseGameSoundsOptions = {}): UseGameSoundsReturn {
  const [isEnabled, setIsEnabled] = useState(enabled);
  const [currentMasterVolume, setCurrentMasterVolume] = useState(masterVolume);
  const [currentMusicVolume, setCurrentMusicVolume] = useState(musicVolume);
  const [currentSfxVolume, setCurrentSfxVolume] = useState(sfxVolume);
  const audioContextRef = useRef<AudioContext | null>(null);

  // Initialize audio context on first user interaction
  useEffect(() => {
    const initAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      }
    };

    // Initialize on first user interaction
    const handleInteraction = () => {
      initAudio();
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };

    document.addEventListener('click', handleInteraction);
    document.addEventListener('keydown', handleInteraction);

    return () => {
      document.removeEventListener('click', handleInteraction);
      document.removeEventListener('keydown', handleInteraction);
    };
  }, []);

  const play = useCallback((sound: SoundType, options: SoundOptions = {}) => {
    if (!isEnabled) return;

    // Lazy initialize audio context
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }

    const ctx = audioContextRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const soundConfig = SOUND_FREQUENCIES[sound];
    const volume = (options.volume ?? 1) * currentMasterVolume * currentSfxVolume;

    // Create oscillator for the sound
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = soundConfig.type;
    oscillator.frequency.setValueAtTime(soundConfig.freq, ctx.currentTime);
    
    // Apply volume envelope
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.01);
    gainNode.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + soundConfig.duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + soundConfig.duration);
  }, [isEnabled, currentMasterVolume, currentSfxVolume]);

  const setEnabled = useCallback((enabled: boolean) => {
    setIsEnabled(enabled);
  }, []);

  const mute = useCallback(() => {
    setIsEnabled(false);
  }, []);

  const unmute = useCallback(() => {
    setIsEnabled(true);
  }, []);

  return {
    enabled: isEnabled,
    masterVolume: currentMasterVolume,
    musicVolume: currentMusicVolume,
    sfxVolume: currentSfxVolume,
    play,
    setEnabled,
    setMasterVolume: setCurrentMasterVolume,
    setMusicVolume: setCurrentMusicVolume,
    setSfxVolume: setCurrentSfxVolume,
    mute,
    unmute,
  };
}

// Singleton hook for global sound access
let globalSounds: UseGameSoundsReturn | null = null;

export function useGlobalSounds(): UseGameSoundsReturn {
  if (!globalSounds) {
    globalSounds = useGameSounds();
  }
  return globalSounds;
}
