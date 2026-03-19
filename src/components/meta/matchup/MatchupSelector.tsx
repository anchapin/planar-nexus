"use client";

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { MagicFormat, ArchetypeCategory } from '@/lib/meta';

interface MatchupSelectorProps {
  playerArchetype: ArchetypeCategory | "";
  opponentArchetype: ArchetypeCategory | "";
  format: MagicFormat;
  onPlayerArchetypeChange: (value: ArchetypeCategory) => void;
  onOpponentArchetypeChange: (value: ArchetypeCategory) => void;
  onFormatChange: (value: MagicFormat) => void;
  onGetGuide: () => void;
}

/**
 * Component for selecting matchup parameters
 */
export function MatchupSelector({
  playerArchetype,
  opponentArchetype,
  format,
  onPlayerArchetypeChange,
  onOpponentArchetypeChange,
  onFormatChange,
  onGetGuide
}: MatchupSelectorProps) {
  const archetypes: { value: ArchetypeCategory; label: string }[] = [
    { value: 'aggro', label: 'Aggro' },
    { value: 'control', label: 'Control' },
    { value: 'midrange', label: 'Midrange' },
    { value: 'combo', label: 'Combo' },
    { value: 'tempo', label: 'Tempo' }
  ];

  const formats: { value: MagicFormat; label: string }[] = [
    { value: 'standard', label: 'Standard' },
    { value: 'modern', label: 'Modern' },
    { value: 'commander', label: 'Commander' }
  ];

  const isValid = playerArchetype !== "" && opponentArchetype !== "";

  return (
    <Card>
      <CardHeader>
        <CardTitle>Select Matchup</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {/* Format Selection */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Format</label>
            <Select value={format} onValueChange={onFormatChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select format" />
              </SelectTrigger>
              <SelectContent>
                {formats.map(f => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Player Archetype */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Your Deck</label>
            <Select value={playerArchetype} onValueChange={onPlayerArchetypeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select your deck" />
              </SelectTrigger>
              <SelectContent>
                {archetypes.map(a => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Opponent Archetype */}
          <div className="space-y-2">
            <label className="text-sm font-medium">Opponent Deck</label>
            <Select value={opponentArchetype} onValueChange={onOpponentArchetypeChange}>
              <SelectTrigger>
                <SelectValue placeholder="Select opponent" />
              </SelectTrigger>
              <SelectContent>
                {archetypes.map(a => (
                  <SelectItem key={a.value} value={a.value}>
                    {a.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <Button 
          onClick={onGetGuide} 
          disabled={!isValid}
          className="w-full"
        >
          Get Matchup Guide
        </Button>
      </CardContent>
    </Card>
  );
}

export default MatchupSelector;
