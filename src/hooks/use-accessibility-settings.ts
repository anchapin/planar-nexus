"use client";

import { useEffect, useState, useCallback } from "react";

export type AccessibilityMode = "standard" | "high-contrast" | "color-blind" | "both";

interface AccessibilitySettings {
  mode: AccessibilityMode;
  highContrast: boolean;
  colorBlind: boolean;
}

const STORAGE_KEY = "planar-nexus-accessibility-settings";

const defaultSettings: AccessibilitySettings = {
  mode: "standard",
  highContrast: false,
  colorBlind: false,
};

function getStoredSettings(): AccessibilitySettings {
  if (typeof window === "undefined") return defaultSettings;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as AccessibilitySettings;
    }
  } catch {
    // ignore parse errors
  }
  return defaultSettings;
}

function storeSettings(settings: AccessibilitySettings): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // ignore storage errors
  }
}

export function useAccessibilitySettings() {
  const [settings, setSettings] = useState<AccessibilitySettings>(defaultSettings);
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    setSettings(getStoredSettings());
    setIsLoaded(true);
  }, []);

  const setHighContrast = useCallback((enabled: boolean) => {
    setSettings((prev) => {
      const next: AccessibilitySettings = {
        ...prev,
        highContrast: enabled,
        mode: enabled && prev.colorBlind ? "both" : enabled ? "high-contrast" : prev.colorBlind ? "color-blind" : "standard",
      };
      storeSettings(next);
      return next;
    });
  }, []);

  const setColorBlind = useCallback((enabled: boolean) => {
    setSettings((prev) => {
      const next: AccessibilitySettings = {
        ...prev,
        colorBlind: enabled,
        mode: prev.highContrast && enabled ? "both" : prev.highContrast ? "high-contrast" : enabled ? "color-blind" : "standard",
      };
      storeSettings(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setSettings(defaultSettings);
    storeSettings(defaultSettings);
  }, []);

  return {
    settings,
    isLoaded,
    highContrast: settings.highContrast,
    colorBlind: settings.colorBlind,
    mode: settings.mode,
    setHighContrast,
    setColorBlind,
    reset,
  };
}
