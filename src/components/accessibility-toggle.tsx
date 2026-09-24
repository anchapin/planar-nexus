"use client";

import { useAccessibilitySettings } from "@/hooks/use-accessibility-settings";
import { cn } from "@/lib/utils";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";

interface AccessibilityToggleProps {
  className?: string;
}

export function AccessibilityToggle({ className }: AccessibilityToggleProps) {
  const { highContrast, colorBlind, setHighContrast, setColorBlind } = useAccessibilitySettings();

  return (
    <div className={cn("flex flex-col gap-3 p-3 rounded-lg border bg-card", className)}>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="high-contrast-toggle" className="text-sm font-medium cursor-pointer">
            High Contrast
          </Label>
          <span className="text-xs text-muted-foreground">
            WCAG AAA 7:1 contrast
          </span>
        </div>
        <Switch
          id="high-contrast-toggle"
          checked={highContrast}
          onCheckedChange={setHighContrast}
          aria-label="Toggle high contrast mode"
        />
      </div>
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <Label htmlFor="color-blind-toggle" className="text-sm font-medium cursor-pointer">
            Color-Blind Safe
          </Label>
          <span className="text-xs text-muted-foreground">
            Deuteranopia/Protanopia safe
          </span>
        </div>
        <Switch
          id="color-blind-toggle"
          checked={colorBlind}
          onCheckedChange={setColorBlind}
          aria-label="Toggle color-blind safe mode"
        />
      </div>
    </div>
  );
}
