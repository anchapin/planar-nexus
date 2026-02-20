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
  | 'error'
  | 'damage_deal'
  | 'damage_take'
  | 'spell_cast'
  | 'life_change'
  | 'card_draw'
  | 'card_discard'
  | 'counter_spell'
  | 'shuffle'
  | 'tap'
  | 'untap'
  | 'phase_change'
  | 'priority_pass';

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
  playBackgroundMusic: () => void;
  stopBackgroundMusic: () => void;
  isMusicPlaying: boolean;
}

// Sound configurations using Web Audio API
// These generate procedural sounds - in production, you'd use actual audio files
const SOUND_CONFIGS: Record<SoundType, { freq: number; duration: number; type: OscillatorType; attack?: number; decay?: number }> = {
  card_cast: { freq: 880, duration: 0.15, type: 'sine', attack: 0.01, decay: 0.1 },
  combat_attack: { freq: 220, duration: 0.3, type: 'sawtooth', attack: 0.02, decay: 0.2 },
  combat_block: { freq: 110, duration: 0.2, type: 'square', attack: 0.01, decay: 0.15 },
  land_play: { freq: 440, duration: 0.1, type: 'sine', attack: 0.005, decay: 0.08 },
  turn_start: { freq: 660, duration: 0.25, type: 'sine', attack: 0.01, decay: 0.2 },
  turn_end: { freq: 330, duration: 0.2, type: 'sine', attack: 0.01, decay: 0.15 },
  game_win: { freq: 523, duration: 0.8, type: 'sine', attack: 0.05, decay: 0.6 },
  game_lose: { freq: 262, duration: 0.6, type: 'triangle', attack: 0.05, decay: 0.4 },
  emote: { freq: 700, duration: 0.1, type: 'sine', attack: 0.005, decay: 0.08 },
  chat_message: { freq: 600, duration: 0.05, type: 'sine', attack: 0.005, decay: 0.04 },
  button_click: { freq: 500, duration: 0.05, type: 'sine', attack: 0.005, decay: 0.04 },
  error: { freq: 200, duration: 0.3, type: 'square', attack: 0.01, decay: 0.25 },
  damage_deal: { freq: 300, duration: 0.25, type: 'sawtooth', attack: 0.02, decay: 0.18 },
  damage_take: { freq: 150, duration: 0.35, type: 'sawtooth', attack: 0.03, decay: 0.25 },
  spell_cast: { freq: 1000, duration: 0.3, type: 'sine', attack: 0.05, decay: 0.2 },
  life_change: { freq: 550, duration: 0.15, type: 'sine', attack: 0.01, decay: 0.1 },
  card_draw: { freq: 750, duration: 0.12, type: 'sine', attack: 0.01, decay: 0.08 },
  card_discard: { freq: 400, duration: 0.15, type: 'triangle', attack: 0.01, decay: 0.1 },
  counter_spell: { freq: 1200, duration: 0.2, type: 'square', attack: 0.02, decay: 0.15 },
  shuffle: { freq: 200, duration: 0.4, type: 'triangle', attack: 0.05, decay: 0.3 },
  tap: { freq: 350, duration: 0.08, type: 'sine', attack: 0.005, decay: 0.06 },
  untap: { freq: 450, duration: 0.08, type: 'sine', attack: 0.005, decay: 0.06 },
  phase_change: { freq: 600, duration: 0.18, type: 'sine', attack: 0.01, decay: 0.12 },
  priority_pass: { freq: 520, duration: 0.1, type: 'sine', attack: 0.005, decay: 0.08 },
};

// Background music configuration (procedural ambient)
const MUSIC_CONFIG = {
  baseFreq: 110,
  chordProgression: [0, 4, 5, 3], // I, IV, V, iii
  tempo: 60, // BPM
};

const STORAGE_KEY = 'planar-nexus-sound-settings';

/**
 * Load settings from localStorage
 */
function loadSettings(): UseGameSoundsOptions {
  if (typeof window === 'undefined') {
    return { enabled: true, masterVolume: 0.5, musicVolume: 0.3, sfxVolume: 0.7 };
  }
  
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (e) {
    console.error('Failed to load sound settings:', e);
  }
  
  return { enabled: true, masterVolume: 0.5, musicVolume: 0.3, sfxVolume: 0.7 };
}

/**
 * Save settings to localStorage
 */
function saveSettings(settings: UseGameSoundsOptions): void {
  if (typeof window === 'undefined') return;
  
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save sound settings:', e);
  }
}

/**
 * Hook for managing game sounds with procedural audio generation
 */
export function useGameSounds(options: UseGameSoundsOptions = {}): UseGameSoundsReturn {
  // Load saved settings on mount
  const savedSettings = typeof window !== 'undefined' ? loadSettings() : options;
  
  const [isEnabled, setIsEnabled] = useState(savedSettings.enabled ?? true);
  const [currentMasterVolume, setCurrentMasterVolume] = useState(savedSettings.masterVolume ?? 0.5);
  const [currentMusicVolume, setCurrentMusicVolume] = useState(savedSettings.musicVolume ?? 0.3);
  const [currentSfxVolume, setCurrentSfxVolume] = useState(savedSettings.sfxVolume ?? 0.7);
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  
  const audioContextRef = useRef<AudioContext | null>(null);
  const musicIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const musicOscillatorsRef = useRef<OscillatorNode[]>([]);

  // Save settings when they change
  useEffect(() => {
    saveSettings({
      enabled: isEnabled,
      masterVolume: currentMasterVolume,
      musicVolume: currentMusicVolume,
      sfxVolume: currentSfxVolume,
    });
  }, [isEnabled, currentMasterVolume, currentMusicVolume, currentSfxVolume]);

  // Initialize audio context on first user interaction
  useEffect(() => {
    const initAudio = () => {
      if (!audioContextRef.current) {
        audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
      }
    };

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
      stopBackgroundMusic();
    };
  }, []);

  const getAudioContext = useCallback(() => {
    if (!audioContextRef.current) {
      audioContextRef.current = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    }
    return audioContextRef.current;
  }, []);

  const play = useCallback((sound: SoundType, options: SoundOptions = {}) => {
    if (!isEnabled) return;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const config = SOUND_CONFIGS[sound];
    if (!config) return;

    const volume = (options.volume ?? 1) * currentMasterVolume * currentSfxVolume;
    const attack = config.attack ?? 0.01;

    // Create oscillator for the sound
    const oscillator = ctx.createOscillator();
    const gainNode = ctx.createGain();

    oscillator.type = config.type;
    oscillator.frequency.setValueAtTime(config.freq, ctx.currentTime);
    
    // Apply volume envelope (ADSR-like)
    gainNode.gain.setValueAtTime(0, ctx.currentTime);
    gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + attack);
    gainNode.gain.setValueAtTime(volume, ctx.currentTime + attack);
    gainNode.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + config.duration);

    oscillator.connect(gainNode);
    gainNode.connect(ctx.destination);

    oscillator.start(ctx.currentTime);
    oscillator.stop(ctx.currentTime + config.duration);
  }, [isEnabled, currentMasterVolume, currentSfxVolume, getAudioContext]);

  const playBackgroundMusic = useCallback(() => {
    if (!isEnabled || isMusicPlaying) return;

    const ctx = getAudioContext();
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    setIsMusicPlaying(true);
    
    // Create ambient background music using chord progression
    let chordIndex = 0;
    const playChord = () => {
      if (!isEnabled) {
        stopBackgroundMusic();
        return;
      }

      // Stop previous oscillators
      musicOscillatorsRef.current.forEach(osc => {
        try {
          osc.stop();
        } catch {
          // Already stopped
        }
      });
      musicOscillatorsRef.current = [];

      const chordRoot = MUSIC_CONFIG.baseFreq * Math.pow(2, MUSIC_CONFIG.chordProgression[chordIndex] / 12);
      const volume = currentMasterVolume * currentMusicVolume * 0.15; // Keep background music subtle

      // Play a simple chord (root, third, fifth)
      [1, 1.25, 1.5].forEach((multiplier) => {
        const oscillator = ctx.createOscillator();
        const gainNode = ctx.createGain();

        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(chordRoot * multiplier, ctx.currentTime);

        // Gentle envelope
        gainNode.gain.setValueAtTime(0, ctx.currentTime);
        gainNode.gain.linearRampToValueAtTime(volume, ctx.currentTime + 0.5);
        gainNode.gain.setValueAtTime(volume, ctx.currentTime + 1.5);
        gainNode.gain.linearRampToValueAtTime(0, ctx.currentTime + 2);

        oscillator.connect(gainNode);
        gainNode.connect(ctx.destination);

        oscillator.start(ctx.currentTime);
        oscillator.stop(ctx.currentTime + 2);
        
        musicOscillatorsRef.current.push(oscillator);
      });

      chordIndex = (chordIndex + 1) % MUSIC_CONFIG.chordProgression.length;
    };

    playChord();
    musicIntervalRef.current = setInterval(playChord, 2000);
  }, [isEnabled, isMusicPlaying, currentMasterVolume, currentMusicVolume, getAudioContext]);

  const stopBackgroundMusic = useCallback(() => {
    if (musicIntervalRef.current) {
      clearInterval(musicIntervalRef.current);
      musicIntervalRef.current = null;
    }

    musicOscillatorsRef.current.forEach(osc => {
      try {
        osc.stop();
      } catch {
        // Already stopped
      }
    });
    musicOscillatorsRef.current = [];

    setIsMusicPlaying(false);
  }, []);

  const setEnabled = useCallback((enabled: boolean) => {
    setIsEnabled(enabled);
    if (!enabled) {
      stopBackgroundMusic();
    }
  }, [stopBackgroundMusic]);

  const mute = useCallback(() => {
    setIsEnabled(false);
    stopBackgroundMusic();
  }, [stopBackgroundMusic]);

  const unmute = useCallback(() => {
    setIsEnabled(true);
  }, []);

  const handleSetMasterVolume = useCallback((volume: number) => {
    setCurrentMasterVolume(Math.max(0, Math.min(1, volume)));
  }, []);

  const handleSetMusicVolume = useCallback((volume: number) => {
    setCurrentMusicVolume(Math.max(0, Math.min(1, volume)));
  }, []);

  const handleSetSfxVolume = useCallback((volume: number) => {
    setCurrentSfxVolume(Math.max(0, Math.min(1, volume)));
  }, []);

  return {
    enabled: isEnabled,
    masterVolume: currentMasterVolume,
    musicVolume: currentMusicVolume,
    sfxVolume: currentSfxVolume,
    play,
    setEnabled,
    setMasterVolume: handleSetMasterVolume,
    setMusicVolume: handleSetMusicVolume,
    setSfxVolume: handleSetSfxVolume,
    mute,
    unmute,
    playBackgroundMusic,
    stopBackgroundMusic,
    isMusicPlaying,
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